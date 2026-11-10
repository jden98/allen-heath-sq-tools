# sq-comp

Unofficial Bitfocus Companion connection module for Allen & Heath SQ-5, SQ-6,
and SQ-7 consoles. Connects **directly to the console TCP port (51326)** using
the SQ API. No OSC bridge, OSC server, or MixPad process is required.

## Build and Install

From the repository root, using Node 22.18 or later in the Node 22 series:

```sh
npm install
npm run build:comp
npm run test:comp
npm run package:comp
```

The package command produces a `.tgz` Companion module archive in this directory.
Import it in Companion's **Modules** page using **Import module**. Use a Companion
release that supports the Node 22 module runtime and module API 1.15.1. For local
development, point Companion's developer module path at the repository's `packages`
directory after building, then restart Companion.

Add the **Allen & Heath SQ (Direct TCP)** connection. Enter the console IP address;
leave the TCP port at 51326 unless your network uses port forwarding. The optional
local interface IP selects a wired network interface on multi-interface machines.
Allow TCP access to the console and inbound UDP to the ephemeral meter socket used
by the API handshake. Failed connections retry automatically.

## Offline Configuration

A connected console is not required to configure the connection or buttons. Actions,
feedbacks, variables, and presets are registered before any connection attempt.
You can leave the console IP blank, configure buttons, and enter or change the IP
later, including while a connection is failing or waiting for its handshake.
Saving configuration does not wait for the console to connect. Connection failures
only affect status and live values; they do not disable configuration controls.
Executing mixer actions and learning current mixer values require a connection.

## Controls

Actions are generated from the same parameter catalog as `sq-osc`, but invoke
`SQMixer` directly, not OSC. The catalog is compiled into the module, so neither
sibling package needs a separate installation. Additional actions cover all four
API patching operations, global scene crossfade, and talkback source selection.

- 48 inputs, 3 stereo inputs, 4 FX returns, 12 buses, 8 DCAs, and Main L/R.
- Faders, mutes, names, pan, preamp, phantom, pad, polarity, HPF, gate,
  compressor, PEQ, delay, inserts, direct output assignment, and PAFL.
- All bus and FX sends exposed by the API, channel color, and mute groups.
- Scene recall, store, delete, rename, crossfade, name, and stored-state feedback.
- Talkback controls and routing, direct output configuration, and IP patching.

Channel, scene, and group numbers are 1-based. Advanced patch actions expose
the API's protocol IDs; their field labels distinguish 0-based IDs from 1-based
socket numbers. Numeric and text action fields support Companion variables.
Numeric actions support relative adjustments; boolean actions support toggles.
Unknown state prevents toggles and relative adjustments until a value is received.
Use an explicit set action when state is unknown. Relative adjustments must remain
within the parameter range. Learn captures the current cached value.

Every readable parameter has comparison feedback (including tolerance for numeric
equality) and a variable. For example:

```text
$(SQ:input_1_name)
$(SQ:input_1_fader)
$(SQ:input_1_mute)
$(SQ:input_1_send_12)
$(SQ:scene_1_name)
$(SQ:scene_1_stored)
$(SQ:connected)
$(SQ:scene_current)
```

Replace `SQ` with your connection label. Parameter variable IDs follow the concrete
catalog address with slashes replaced by underscores. Unknown values are blank;
unknown comparison feedback is false, and all parameter caches clear on disconnect.
`scene_current` is the last recall-complete event received while connected, not a
guessed startup scene. Fader/send off values are represented as -90 dB.

Presets include channel mute and PAFL toggles with live feedback, 300 scene recall
buttons, and push-to-talk (on when pressed, off when released). Store/delete actions
are intentionally not included in presets.

## Bidirectional Support and Limits

The TCP handshake subscribes to console parameters. Companion reads the API's
decoded state every 100 ms without sending polling traffic to the console, so
physical and remote changes update feedback and variables. Setters that update
the API cache optimistically can update Companion before the console echo arrives;
feedback is cached state, not an acknowledgement that a write succeeded.

Coverage is **every parameter currently exposed by this repository's SQ API**, not
every possible console feature. The reverse-engineered API does not yet decode all
initial-state or incoming parameter data. In particular, patching, channel color,
most talkback settings, direct-output global settings, and global scene crossfade
are currently write-only in this module. Talkback on/gain and per-scene crossfade
have API caches but incomplete incoming update handling. These limitations mean
full console-wide bidirectionality cannot be claimed yet. No state is invented for
write-only controls. Meter values, fader layer assignments, and the hardware monitor
potentiometer are not supported. Stereo addressing and some mappings remain
unverified on hardware; see the API feature inventory.

The tests use a loopback TCP console simulator and verify the real API handshake,
binary writes, incoming mute/scene events, cache invalidation, and reconnects.
Actual console and Companion application testing is still required before show use.
Scene store/delete, patching, and phantom power actions can affect live audio.

This is an independent interoperability project, not affiliated with Allen & Heath
or Bitfocus. Source code is MIT licensed; see the repository license.