# USB PPP connectivity probe

This standalone ESP-IDF application checks the wired link before modifying the ComPallette gateway sketch. Flashing it replaces the application temporarily. Restore the normal gateway sketch after testing.

## Prepare the host

Use WSL 2 with usbipd-win, or a Linux VM with USB passthrough and NAT. In Windows, close Serial Monitor, identify the ESP32-S3 native USB Serial/JTAG device with `usbipd list`, and bind it once from an elevated shell with `usbipd bind --busid BUSID`. Attach it with `usbipd attach --wsl --busid BUSID` after opening the WSL distribution. If the board exposes a separate USB-to-UART connector, leave that connector attached to Windows for diagnostic output.

In Linux, install `ppp`, `iptables`, and Python 3. Identify the board's `/dev/ttyACM*` device and check that `/dev/ppp` is usable. If your WSL kernel lacks PPP support, run these Linux steps in the VM. Check that neither `10.77.0.1` nor `10.77.0.2` overlaps your existing routes. From Linux, verify that `curl http://WINDOWS_IP:8000/health/` returns 2xx. Use that same URL in the probe configuration.

## Build and flash

With ESP-IDF 5.5.2 activated, run these commands from this directory. Set the Django health URL in the **ComPallette PPP probe** menu.

```sh
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
idf.py -p COM_NUMBER flash
```

Flash from Windows before attaching the USB device to Linux. Substitute the real COM port. Probe output goes to UART0 at 115200 baud. The native USB Serial/JTAG data stream carries PPP bytes during the test.

## Run the peer

In Linux, start the peer while the native port is attached. Substitute the actual tty device. The bench link uses fixed addresses and trusts the USB endpoint.

```sh
sudo pppd /dev/ttyACM0 115200 local noauth nocrtscts \
  10.77.0.1:10.77.0.2 nodefaultroute noipv6 ms-dns 1.1.1.1 \
  ifname ppp-cp lcp-echo-interval 10 lcp-echo-failure 3 nodetach debug
```

Start the following in a second terminal as soon as `ppp-cp` is up. Use a disposable Linux instance dedicated to the bench. The subshell restores forwarding and removes its own rules when stopped with Ctrl+C.

```sh
sudo sh -eu <<'EOF'
upstream=$(ip -4 route get 1.1.1.1 | awk '{for (i=1;i<NF;i++) if ($i=="dev") {print $(i+1); exit}}')
test -n "$upstream"
test "$upstream" != ppp-cp
previous=$(sysctl -n net.ipv4.ip_forward)
cleanup() {
    iptables -t nat -D POSTROUTING -s 10.77.0.2/32 -o "$upstream" -j MASQUERADE || :
    iptables -D FORWARD -i ppp-cp -s 10.77.0.2/32 -o "$upstream" -j ACCEPT || :
    iptables -D FORWARD -o ppp-cp -j CP_PPP_IN || :
    iptables -F CP_PPP_IN || :
    iptables -X CP_PPP_IN || :
    sysctl -qw net.ipv4.ip_forward="$previous"
}
iptables -N CP_PPP_IN
trap cleanup EXIT
trap 'exit 1' INT TERM
iptables -A CP_PPP_IN -i "$upstream" -d 10.77.0.2/32 \
    -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A CP_PPP_IN -j DROP
iptables -I FORWARD -o ppp-cp -j CP_PPP_IN
iptables -I FORWARD -i ppp-cp -s 10.77.0.2/32 -o "$upstream" -j ACCEPT
iptables -t nat -A POSTROUTING -s 10.77.0.2/32 -o "$upstream" -j MASQUERADE
sysctl -qw net.ipv4.ip_forward=1
cd "$(mktemp -d)"
exec_dir=$PWD
trap 'cleanup; rmdir "$exec_dir"' EXIT
python3 -m http.server 8080 --bind 10.77.0.1
EOF
```

If the probe ran before forwarding and the peer HTTP listener were ready, reset the ESP32 and restart `pppd` if the port re-enumerates. Check the UART0 output for three passes and `Connectivity gate: PASS`. The public HTTPS check uses SNTP to set the device clock before certificate validation. The Linux peer should independently report the assigned addresses.

Stop the forwarding shell and `pppd` before detaching the USB device with `usbipd detach --busid BUSID`. Release the device from the VM if using that path. The existing USB-C port can then be used to flash the normal gateway sketch.
