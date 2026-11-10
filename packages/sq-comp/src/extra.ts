import type { InputPatchSource, OutputPatchDest, MonitorOutSource } from "../../sq-api/src/api/mixer.ts";
import type { OscArg, OscEntry } from "./catalog.ts";

const integer = (name: string, description: string, min: number, max: number, choices?: number[]): OscArg =>
  ({ name, description, type: "i", min, max, choices });
const destination = integer("destination", "Output port: 26=Local, 27=ME, 28=SLink, 29=USB, 30=IOPort", 26, 30);
const socket = integer("socket", "Output socket number (1-based)", 1, 256);

export function extraEntries(): OscEntry[] {
  return [
    {
      address: "/scene/crossfade", description: "Global scene crossfade in seconds", group: "global",
      setArgs: [{ name: "seconds", description: "Crossfade in seconds", type: "f", min: 0, max: 20 }],
      getArgs: [], readable: false, writable: true,
      set: (sq, _indices, args) => sq.setSceneCrossfadeSeconds(Number(args[0])),
    },
    {
      address: "/talkback/source", description: "Talkback source ID", group: "global",
      setArgs: [integer("source", "Protocol source ID (0-based)", 0, 255)],
      getArgs: [], readable: false, writable: true,
      set: (sq, _indices, args) => sq.setTalkbackSource(Number(args[0])),
    },
    {
      address: "/patch/input", description: "Patch physical input to DSP channel", group: "patch",
      setArgs: [integer("source", "1=Local, 2=SLink, 3=USB, 4=IOPort", 1, 4),
        integer("socket", "Source channel protocol ID (0-based)", 0, 255),
        integer("channel", "Destination DSP b3 ID (0-based)", 0, 255)],
      getArgs: [], readable: false, writable: true,
      set: (sq, _indices, args) => sq.setInputPatch(Number(args[0]) as InputPatchSource, Number(args[1]), Number(args[2])),
    },
    {
      address: "/patch/output", description: "Patch DSP channel to physical output", group: "patch",
      setArgs: [integer("channel", "Source DSP b3 ID (0-based)", 0, 255), destination, socket],
      getArgs: [], readable: false, writable: true,
      set: (sq, _indices, args) => sq.setOutputPatch(Number(args[0]), Number(args[1]) as OutputPatchDest, Number(args[2])),
    },
    {
      address: "/patch/fxreturn", description: "Patch rack FX return to physical output", group: "patch",
      setArgs: [integer("fx", "Rack FX number", 1, 8),
        { name: "side", description: "Left or right", type: "s", choices: ["L", "R"] }, destination, socket],
      getArgs: [], readable: false, writable: true,
      set: (sq, _indices, args) => sq.setOutputPatchFxReturn(Number(args[0]), args[1] as "L" | "R", Number(args[2]) as OutputPatchDest, Number(args[3])),
    },
    {
      address: "/patch/monitor", description: "Patch monitor to physical output", group: "patch",
      setArgs: [integer("source", "0=PAFL L, 1=PAFL R, 2=Listen L, 3=Listen R, 4=Listen M, 5=Talkback", 0, 5), destination, socket],
      getArgs: [], readable: false, writable: true,
      set: (sq, _indices, args) => sq.setOutputPatchMonitor(Number(args[0]) as MonitorOutSource, Number(args[1]) as OutputPatchDest, Number(args[2])),
    },
    {
      address: "/scene/{n}/stored", description: "Scene is stored", group: "global",
      setArgs: [], getArgs: [integer("stored", "0=empty, 1=stored", 0, 1)], readable: true, writable: false,
      get: (sq, indices) => {
        const value = sq.sceneStored[indices[0] - 1];
        return value === null ? undefined : [value ? 1 : 0];
      },
    },
  ];
}