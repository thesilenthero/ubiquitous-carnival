#!/bin/sh
# Print the addresses this machine is about to be reachable at, so you don't
# have to go looking for them before picking up your phone.
#
# The Bonjour (.local) name is listed first on purpose: the LAN IP is handed out
# by DHCP and will eventually change, while the name follows it. The IP is read
# live rather than hardcoded, so when it does change this prints the new one.

port="${PORT:-4000}"
name="$(scutil --get LocalHostName 2>/dev/null)"

# The Wi-Fi interface isn't always en0 (docks and USB ethernet take lower
# numbers), so take the first interface that actually has an address.
ip=""
for iface in $(networksetup -listallhardwareports 2>/dev/null | awk '/Device:/{print $2}'); do
  ip="$(ipconfig getifaddr "$iface" 2>/dev/null)"
  [ -n "$ip" ] && break
done

printf '\n  Job Tracker — serving on port %s\n\n' "$port"
printf '    this Mac   http://localhost:%s\n' "$port"
[ -n "$name" ] && printf '    phone      http://%s.local:%s\n' "$name" "$port"
[ -n "$ip" ] && printf '    or         http://%s:%s\n' "$ip" "$port"
if [ -z "$name" ] && [ -z "$ip" ]; then
  printf '    (no network address found — are you connected to Wi-Fi?)\n'
fi
printf '\n  Phone must be on the same network. Ctrl-C to stop.\n\n'
