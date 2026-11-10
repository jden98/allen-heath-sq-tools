# Allen & Heath SQ (Direct TCP)

Enter the console IP address and TCP port (default 51326). This connection talks
directly to the console; it does not use the SQ OSC bridge. An optional local IP
selects the network interface. Disconnects are retried automatically.

Connection and button configuration work without a connected console. You can leave
the console IP blank and configure actions, feedbacks, variables, and presets first.
The IP remains editable during connection failures or an incomplete handshake.
Only mixer action execution and learning current values require connectivity.

Actions cover all SQ API parameters and include channel processing, sends,
scene operations, talkback, direct outputs, and patching. Choose the channel,
scene, or group number (1-based). Advanced patch fields use protocol IDs as labeled.

Readable parameters provide variables and comparison feedback. Unknown values are
blank and feedback is false. Toggle and relative actions require known state;
explicit set actions do not. Learn captures cached values. Use `$(this:input_1_name)`
and `$(this:input_1_fader)` in button text. Presets provide mute, PAFL, scene recall,
and push-to-talk buttons.

Coverage and feedback are limited by the reverse-engineered SQ API. Patching,
channel color, most talkback settings, global direct-output configuration, and global
scene crossfade are write-only. Some incoming and initial-state fields are not yet
decoded. Metering and hardware-only controls are unsupported. Optimistic cached
feedback is not console write acknowledgement. Test on your console before live use.

Scene store/delete, patching, and phantom power actions may disrupt live audio.