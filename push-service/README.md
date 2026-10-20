# TASNI background alert service 2.3.0

This private Node 24+ service reads TASNI state topics over MQTT TLS and sends real Web Push notifications. It must run continuously even when every dashboard page is closed. The current installation is the Windows scheduled task **TASNI Background Alerts** on the owner's PC; it starts at user logon and restarts after failures.

## Source and configuration

The parent app repository holds `push-client.js`, `push-protocol.js`, `push-config.js` and `sw.js`. This service directory contains an independent copy of the shared protocol and the server code. Keep the protocol copies identical when updating them.

Run `npm install --ignore-scripts` in this directory, then provision once:

1. Supply `TASNI_DEVICE_PASSWORD` and `TASNI_MQTT_PASSWORD` through private environment variables. Optional `TASNI_DEVICE_ID` defaults to the current board. Never place passwords in source files or command history.
2. Set `TASNI_PUSH_DATA` to a private persistent directory outside the checkout. Run `npm run provision`. Remove the credential environment variables afterwards.
3. Copy the generated **public** `push-config.js` to the app root. It pins the service encryption key and VAPID public key. It contains no private key or password.
4. Set `TASNI_PUSH_CONFIG` to the absolute private `config.json` path. Run `npm start`, or use `node server/supervise.cjs` under a process manager. The latter uses `TASNI_PUSH_DATA` for its log directory.
5. On each phone, connect the exact device topic, enable background alerts with the device password, grant notifications, and perform the delayed closed-app test.

The private configuration contains broker credentials, VAPID / encryption private keys and device password verifiers. The SQLite database contains subscriptions and delivery state. Restrict both to the service account; never serve, commit or share them. The `.gitignore` is an additional safeguard, not a substitute for storing secrets outside the repository. The configuration's `devices` map supports additional provisioned devices; each device can enroll up to 16 phones. Provision a distinct verifier using the shared protocol's `pinKey(password, deviceId)` for each new device.

For migration to an always-on server, stop the old service, copy its private configuration and database to a private server directory, retain the same keys and service ID, install the same dependencies and start under a service manager. Do not run two copies with the same MQTT client ID. Keeping the keys and subscriptions avoids asking phones to enroll again. Back up the database only after stopping the service or by using a proper SQLite backup; copying an active WAL database file alone can lose recent changes.

## MQTT and delivery behavior

- State input: `tasni-water/<12-character MAC>/state` (unchanged).
- Encrypted enrollment / management: `tasni-water/<MAC>/push/request` and `tasni-water/<MAC>/push/response/<random request ID>`.
- Service availability: `tasni-water/push/service/<service ID>`. Configure broker ACLs to allow the service the listed topics and each phone only its own device topics plus service availability. Broker access does not replace the device password required for enrollment.
- Service request messages are never retained. Replay IDs are persisted. Subscription secrets and management tokens are encrypted in transit over MQTT as well as protected by TLS.
- Retained, invalid, duplicate or stale state packets cannot raise current alarms. Critical low-water alarms require two current valid samples. Rapid drops require a confirming sample. Low / refill / full events also require confirmation. Night loss follows 22:00–06:00 IST and each phone's configured threshold. Device data unavailable is reported after two minutes, with a startup / resume grace period.
- Critical notifications request high push urgency, sound, vibration and acknowledgement. Up to three reminders follow the initial critical alert at five-minute intervals unless acknowledged or the critical low-water condition resolves. Android and browser settings ultimately control presentation and sound.
- Failed network delivery is retried; expired subscriptions are removed. Notifications use a two-minute TTL. The server must remain online and a phone must be enrolled; permission alone is insufficient. A force-stopped browser or OS restrictions can prevent delivery.
- The delayed test is explicitly labelled TEST and does not modify device readings or simulate a real emergency.

Run `npm test` (Node 24+). Unit tests cover protocol authorization, replay rejection, sensor validation, persisted delivery state, preferences, reminders, acknowledgements, retry handling and notification actions. Always verify actual delivery on each target phone too.
