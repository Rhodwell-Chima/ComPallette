"""Scoped operator administration. Account-wide changes are superuser only."""
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from .access import enforce, operator_capabilities
from .models import SiteMembership, Personnel, MembershipRole
from .operations import audit


def context(request):
    from .views import resolve_site
    site = resolve_site(request)
    if site is None:
        raise PermissionDenied('Select a permitted site.')
    enforce(request.user, 'manage_users', site)
    memberships = SiteMembership.objects.filter(organisation=site.organisation).filter(Q(site=site) | Q(site__isnull=True))
    return site, memberships


def user_data(user, site, memberships):
    membership = memberships.filter(user=user).order_by('-site_id').first()
    person = Personnel.objects.filter(user=user, organisation=site.organisation).first()
    return {'id': user.pk, 'username': user.username, 'email': user.email,
        'first_name': user.first_name, 'last_name': user.last_name,
        'full_name': user.get_full_name() or user.username,
        'role': membership.role if membership else 'VIEWER',
        'status': 'ACTIVE' if user.is_active and membership and membership.active else 'SUSPENDED',
        'last_active': int(user.last_login.timestamp() * 1000) if user.last_login else None,
        'site_id': site.pk, 'site_name': site.name, 'organisation_name': site.organisation.name,
        'assigned_node_id': person.assigned_node_id if person else None,
        'assigned_personnel_id': person.pk if person else None,
        'capabilities': operator_capabilities(user, site)}


class UserListCreateView(APIView):
    def get(self, request):
        site, memberships = context(request)
        users = get_user_model().objects.filter(compallette_memberships__in=memberships).distinct().order_by('username')
        query = request.query_params.get('search', '')
        if query:
            users = users.filter(Q(username__icontains=query) | Q(first_name__icontains=query) | Q(last_name__icontains=query))
        rows = [user_data(u, site, memberships) for u in users]
        for field in ('role', 'status'):
            if request.query_params.get(field):
                rows = [r for r in rows if r[field] == request.query_params[field]]
        try:
            page = max(1, int(request.query_params.get('page', 1)))
            size = max(5, min(100, int(request.query_params.get('page_size', 25))))
        except ValueError:
            raise ValidationError('Invalid pagination.')
        return Response({'users': rows[(page-1)*size:page*size], 'total': len(rows), 'page': page,
                         'page_size': size, 'total_pages': max(1, (len(rows)+size-1)//size)})

    @transaction.atomic
    def post(self, request):
        site, _ = context(request)
        username = str(request.data.get('username', '')).strip()
        role = request.data.get('role', 'VIEWER')
        if not username or role not in MembershipRole.values:
            raise ValidationError('A username and valid role are required.')
        if role == 'ORG_ADMIN' and not request.user.is_superuser:
            raise PermissionDenied('Only a superuser can grant organisation administrator access.')
        if get_user_model().objects.filter(username=username).exists():
            raise ValidationError({'username': 'This username already exists.'})
        user = get_user_model().objects.create(username=username, email=str(request.data.get('email', '')).strip(),
            first_name=str(request.data.get('first_name', '')).strip(), last_name=str(request.data.get('last_name', '')).strip())
        # An unusable password avoids a shared or silently reusable temporary credential.
        # The administrator establishes the first password through the secured reset flow.
        user.set_unusable_password(); user.save()
        SiteMembership.objects.create(user=user, organisation=site.organisation, site=site, role=role)
        audit(request.user, site, 'USER_CREATED', user, {})
        return Response({'id': user.pk, 'message': 'Account created; secure password setup is required.'}, status=201)


class UserDetailView(APIView):
    def get(self, request, user_id):
        site, memberships = context(request)
        user = get_object_or_404(get_user_model().objects.filter(compallette_memberships__in=memberships).distinct(), pk=user_id)
        return Response(user_data(user, site, memberships))

    @transaction.atomic
    def patch(self, request, user_id):
        site, memberships = context(request)
        user = get_object_or_404(get_user_model().objects.select_for_update().filter(pk__in=memberships.values('user_id')), pk=user_id)
        if any(k in request.data for k in ('first_name', 'last_name', 'email')):
            if not request.user.is_superuser:
                raise PermissionDenied('Global account details require a superuser.')
            for field in ('first_name', 'last_name', 'email'):
                if field in request.data:
                    setattr(user, field, str(request.data[field]).strip())
            user.save()
        membership = get_object_or_404(SiteMembership.objects.select_for_update(), user=user, site=site, organisation=site.organisation)
        if 'role' in request.data:
            role = request.data['role']
            if role not in MembershipRole.values:
                raise ValidationError('Invalid role.')
            if (role == 'ORG_ADMIN' or membership.role == 'ORG_ADMIN') and not request.user.is_superuser:
                raise PermissionDenied('Organisation administrator changes require a superuser.')
            membership.role = role
        if 'status' in request.data:
            if request.data['status'] not in ('ACTIVE', 'SUSPENDED'):
                raise ValidationError('Invalid status.')
            if user.pk == request.user.pk:
                raise ValidationError('You cannot suspend your own membership.')
            membership.active = request.data['status'] == 'ACTIVE'
        membership.save()
        audit(request.user, site, 'MEMBERSHIP_UPDATED', user, {'membership_id': membership.pk})
        return Response(user_data(user, site, memberships))


class UserBulkActionView(APIView):
    @transaction.atomic
    def post(self, request):
        site, memberships = context(request)
        ids = request.data.get('user_ids')
        action = request.data.get('action')
        if not isinstance(ids, list) or not ids or len(ids) > 100:
            raise ValidationError('Supply between 1 and 100 user IDs.')
        if action == 'delete':
            raise ValidationError('Archive access by suspending site memberships; historical accounts cannot be deleted.')
        if action not in ('activate', 'suspend', 'change_role'):
            raise ValidationError('Unsupported bulk action.')
        targets = list(SiteMembership.objects.select_for_update().filter(site=site, user_id__in=ids))
        if len(targets) != len(set(ids)):
            raise PermissionDenied('Every target must have a membership in the selected site.')
        role = request.data.get('role')
        if action == 'change_role' and role not in MembershipRole.values:
            raise ValidationError('Invalid role.')
        for membership in targets:
            if membership.user_id == request.user.pk and action == 'suspend':
                raise ValidationError('Cannot suspend your own membership.')
            if not request.user.is_superuser and (membership.role == 'ORG_ADMIN' or role == 'ORG_ADMIN'):
                raise PermissionDenied('Organisation administrator changes require a superuser.')
            if action == 'change_role': membership.role = role
            else: membership.active = action == 'activate'
            membership.save()
        audit(request.user, site, 'MEMBERSHIPS_UPDATED', site, {'user_ids': ids, 'action': action})
        return Response({'updated': len(targets), 'message': 'Site memberships updated.'})


class UserPasswordResetView(APIView):
    @transaction.atomic
    def post(self, request, user_id):
        site, memberships = context(request)
        if not request.user.is_superuser:
            raise PermissionDenied('Global password changes require a superuser.')
        user = get_object_or_404(get_user_model().objects.filter(compallette_memberships__in=memberships).distinct(), pk=user_id)
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        password = request.data.get('password')
        if not isinstance(password, str):
            raise ValidationError({'password': 'Supply a new password through this protected form.'})
        try: validate_password(password, user)
        except DjangoValidationError as exc: raise ValidationError({'password': exc.messages})
        user.set_password(password); user.save()
        audit(request.user, site, 'PASSWORD_RESET', user, {})
        return Response({'message': 'Password changed.'})
