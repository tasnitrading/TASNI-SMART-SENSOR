# TASNI Water Monitor v2.3.0

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

Close and reopen or refresh the PWA to load v2.3.0. Navigation is network-first with an offline fallback; authenticated device responses are never cached.

## Checks

Run `node tests/app.test.js` (Node 20+). Tests cover Basic Auth, device/topic isolation, cached versus live readings, validation, duplicate messages, legitimate large level changes, and confirmed versus failed Wi-Fi updates.

## Closed-app alerts (v2.3.0)

In **Alerts → Background alerts**, enter the device dashboard password, tap **Enable**, and allow browser notifications. Wait for **ENROLLED · alert service online**, then tap **TEST IN 10 SECONDS** and close the app page. A clearly labelled test should arrive. Permission alone does not enroll a phone. The existing device state topic and MQTT credentials remain unchanged.

The private service watches MQTT while the app is closed. It covers critical / low water, confirmed rapid drops, refill / full tank, night water loss, and missing device data. Critical alarms request persistent notifications, sound and vibration, with up to three reminders five minutes apart. **Acknowledge** stops reminders for that phone; a refill resolves the low-water critical condition. Android / browser notification settings, mute and Do Not Disturb control the actual sound.

The service currently runs on the owner's Windows PC in the `TASNI Background Alerts` scheduled task. That PC must stay running, signed in and connected. For continuous production operation, move the same service and private configuration to a continuously running server. A sleeping, powered-off or disconnected service cannot send alerts; a force-stopped browser, disabled site permission or offline phone can also prevent delivery. Alerts expire after two minutes rather than appearing much later as a current emergency.

Enrollment and management use encrypted MQTT request / response messages authenticated by the device password and a per-phone management token. No inbound Internet port or new customer email account is required. The public `push-config.js` contains only public keys. Never commit the private service `config.json`, database, subscription endpoints, tokens or `.env` files.

Service source, provisioning and tests are in [`push-service/`](push-service/). Run `node --test push-service/tests/*.test.cjs` with Node 24+ to check the service and worker behavior. These tests do not prove delivery to a particular phone: complete the closed-app test on that phone.
