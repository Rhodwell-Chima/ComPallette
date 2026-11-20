"""Site-scoped authorisation shared by HTTP and application services."""
from django.db.models import Q, F
from rest_framework.exceptions import PermissionDenied
from .models import MembershipRole, Site, SiteMembership

ROLE_CAPABILITIES = {
    MembershipRole.ORG_ADMIN: {'view', 'view_audit', 'manage_settings', 'manage_sites', 'manage_users', 'manage_devices', 'operate_alerts', 'manage_assets', 'manage_integrations'},
    MembershipRole.SITE_ADMIN: {'view', 'view_audit', 'manage_settings', 'manage_sites', 'manage_devices', 'operate_alerts', 'manage_assets'},
    MembershipRole.OPERATIONS: {'view', 'view_audit', 'operate_alerts', 'manage_assets'},
    MembershipRole.SAFETY: {'view', 'view_audit', 'operate_alerts'},
    MembershipRole.TECHNICIAN: {'view', 'manage_devices'},
    MembershipRole.VIEWER: {'view'},
}


def permitted_sites(user):
    if not user.is_authenticated or not user.is_active:
        return Site.objects.none()
    sites = Site.objects.filter(active=True, organisation__active=True)
    if user.is_superuser:
        return sites
    memberships = SiteMembership.objects.filter(user=user, active=True, organisation__active=True)
    return sites.filter(Q(organisation_id__in=memberships.filter(site__isnull=True).values('organisation_id')) |
                        Q(id__in=memberships.filter(site__organisation_id=F('organisation_id')).values('site_id')))


def operator_capabilities(user, site=None):
    if not user.is_authenticated or not user.is_active:
        return []
    if user.is_superuser:
        return sorted(set().union(*ROLE_CAPABILITIES.values()))
    memberships = SiteMembership.objects.filter(user=user, active=True, organisation__active=True)
    if site is not None:
        if not site.active or not site.organisation.active:
            return []
        memberships = memberships.filter(organisation=site.organisation).filter(Q(site=site) | Q(site__isnull=True))
    else:
        # Only organisation-wide roles have authority without a target site.
        memberships = memberships.filter(site__isnull=True)
    return sorted(set().union(*(ROLE_CAPABILITIES.get(m.role, set()) for m in memberships)))


def enforce(user, capability, site):
    if capability not in operator_capabilities(user, site):
        raise PermissionDenied('You do not have permission for this operation in this site.')
