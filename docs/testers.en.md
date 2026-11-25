# Connect your treadmill to Romeria

Set up off the belt with the treadmill stopped. Keep its remote, Stop button and safety key available. Romeria never starts the treadmill or increases its speed. Closing the game does not stop the belt. No purchase or extra exercise is needed for this test.

## 1. Run the local diagnostic

Close any manufacturer fitness app that may already own the Bluetooth connection. Enable Bluetooth in Windows. In the installed game's server package folder, double-click **romeria-diagnostic.cmd**. Select your device number, then enter its brand and model without a serial number. The tool listens for 5 seconds, discovers services and listens to the selected device for up to 25 seconds. It sends no treadmill command, pairing request, proprietary initialization or control request. Subscribing to measurements writes only the Bluetooth notification descriptor (CCCD).

If no device is heard, report that result. If a name is unclear, check the manual and repeat once with your treadmill powered off, then on with its belt stopped, to identify which advertisement belongs to it. Never unplug a moving treadmill. An empty scan can mean a disabled adapter, a sleeping sensor, another app holding the connection, or no readable BLE interface. Bluetooth audio and a wireless remote do not prove fitness data support.

From a terminal in that same folder:

```powershell
.\romeria-diagnostic.cmd --modele "LONTEK 3.0 HP" --rapport rapport-lontek.txt
```

The file is created locally, never uploaded, and an existing report is never overwritten. Advanced use: `--adresse AA:BB:CC:DD:EE:FF` selects an address without the menu. The menu shows addresses locally; the shareable report hides them. `--langue fr` selects French. Developers with the source kit use `node bin/diagnostic.ts --pilote path/to/ashiato-ftms.exe` instead. `--simuler` checks the tool without Bluetooth and labels the report as simulation.

## 2. Choose the result

| Result | Next step |
| --- | --- |
| FTMS and readable speed | Use the game's FTMS selector, or the FTMS bridge below. Zero speed is a valid stopped reading. |
| RSC and readable speed | Use the RSC bridge. The speed is from the footpod, not the treadmill motor. Calibration belongs to the sensor's documented setup. |
| FitShow, KingSmith or other proprietary signature | Send the report. A shared UUID is only a clue. KingSmith classic status may be decoded if it arrives spontaneously. FitShow packets remain undecoded because units and variants require confirmation. No handshake is sent to make a silent machine talk. |
| No readable speed, or no device | Use declared speed, an existing compatible BLE RSC sensor, or Stroll to explore without walking credit. Do not buy a sensor just for the test. ANT+ alone is not BLE RSC. |

## 3. Start a bridge and connect the installed game

Keep the bridge console open. Start Romeria and stop the physical belt before changing sources. In PowerShell, from the server package folder:

```powershell
# Footpod, with the address shown locally by the diagnostic
.\romeria-pont.cmd --connecteur rsc --adresse AA:BB:CC:DD:EE:FF --pilote .\ftms\ashiato-ftms.exe
# Or a standard FTMS treadmill
.\romeria-pont.cmd --connecteur ftms --adresse AA:BB:CC:DD:EE:FF --pilote .\ftms\ashiato-ftms.exe
```

In a second terminal, run `.\romeria-brancher.cmd`. It selects `pont` at `http://127.0.0.1:8800`, using the game's private local token without displaying it. It preserves the coach and other settings. The default profile is `%LOCALAPPDATA%\Romeria`; for a different installation use `--profil "path/to/profile"`. An older developer setup may use `%LOCALAPPDATA%\Ashiato`. HTTP 409 means the game believes the belt is moving: stop physically first. This helper refuses remote URLs and never contacts a Pi.

The native in-game diagnostic button is pending; the package shortcuts are the current entry point. If your installed build lacks them, the organizer must provide the updated package or this source kit with Node 24. Source-kit commands are `node bin/pont.ts ...` and `node bin/brancher.ts ...`.

## 4. No readable treadmill: declare its speed

```powershell
.\romeria-pont.cmd --connecteur declare
```

Connect it with `romeria-brancher.cmd` as above. Start and adjust the treadmill yourself with its physical remote. When safe to do so, type its displayed speed in **km/h** in the bridge console and press Enter. For example, `3.0`. A decimal comma also works. `pause` suspends the estimate, and `0` declares that you have stopped. This input never sends a command to the treadmill. Do not type while walking if doing so distracts you.

The supported declaration range is 0 to 10 km/h. This is an input limit, not a recommendation or a command qualification. The bridge starts disarmed, requires confirmation at least every 15 minutes, and disarms after a reading gap over 3 seconds. Reopening the game or bridge never restores the old declaration. Confirm only the speed actually set; if it changes, update it when safe or suspend the estimate. Stop in the game suspends the estimate and reports that physical Stop is still required. RSC cannot stop the treadmill either.

Declared sessions are labelled **Speed declared by the player** in the Journal's Bilan notes, including mixed sessions. Distance is estimated. RSC sessions have a footpod note. Both use the existing plan limits; more walking outside the plan does not earn extra rewards. Follow your own plan and coach. Stroll and kit simulations earn no walking credit.

## 5. Send only the report

Copy from `Romeria diagnostic v1` to the end, review it, then send it through the organizer's agreed private feedback channel. Add the game version, Windows version, whether another app was connected, and the model on the device label. Do not send settings, tokens, serial numbers, training plans or raw Bluetooth captures. This tool sends nothing automatically.

For the LONTEK example, also tell the organizer the exact model/reference on the label, the manual's app name or QR destination if any, whether Bluetooth is explicitly mentioned, and what buttons the remote has. A 3.0 HP, 10 km/h listing alone cannot establish connectivity.
