# TASNI Water Monitor v2.2.0

Live water tank dashboard for TASNI ESP32 firmware. Open this repository's GitHub Pages site or install it as a PWA.

## Connection

- Use the broker WSS port **8084** and path `/mqtt` in this app. Firmware uses native TLS port **8883**.
- Enter the exact per-device topic: `tasni-water/<FULL_MAC_WITHOUT_COLONS>/state`. For this board: `tasni-water/D4E9F4B23600/state`.
- Broker ONLINE means the app connected to MQTT. The dashboard labels current device samples LIVE and retained values LAST KNOWN. Cached values do not create alerts or usage records.
- A wildcard subscription binds to one device to avoid mixing readings; enter an exact topic to switch devices.

## Change Wi-Fi from a phone

Use firmware **6.2.4-TEST.1 or later**. Connect the phone to the same LAN as the ESP32 or its TASNI recovery hotspot. In Settings enter the device IP and its dashboard password (username `admin`). Allow Local Network Access if the browser requests it. The app uses HTTP Basic Auth; no MQTT or device passwords are embedded in this repository.

Blank Wi-Fi password keeps the saved password for the same SSID. For a different SSID, enter its password or explicitly select Open network. The firmware replies before switching, tests the candidate for up to 30 seconds, and saves only after a stable connection. Failure restores the previous credentials. Recovery setup is `http://192.168.4.1/setup` after joining the TASNI hotspot; no USB cable or physical button is needed.

A phone on another Internet connection cannot send local HTTP configuration requests to a private device IP. This release does not add an Internet-facing configuration command service. A device without a working Internet connection requires local wireless recovery.

## Update

Close and reopen or refresh the PWA to load v2.2.0. Navigation is network-first with an offline fallback; authenticated device responses are never cached.

## Checks

Run `node tests/app.test.js` (Node 20+). Tests cover Basic Auth, device/topic isolation, cached versus live readings, validation, duplicate messages, legitimate large level changes, and confirmed versus failed Wi-Fi updates.
