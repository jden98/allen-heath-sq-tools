import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { test } from "node:test";
import { MixerController } from "../src/controller.ts";
import { Framer, encodeFrame, Sub, DSP_MARKER } from "../../sq-api/src/transport/frame.ts";

test("direct TCP handshake, writes, live feedback, disconnect and reconnect", { timeout: 10000 }, async context => {
  const sockets = new Set<Socket>();
  let peer: Socket | undefined;
  const frames: Buffer[] = [];
  const server = createServer(socket => {
    sockets.add(socket);
    peer = socket;
    socket.on("close", () => sockets.delete(socket));
    const framer = new Framer();
    socket.on("data", chunk => {
      for (const frame of framer.push(chunk)) {
        switch (frame.subType) {
          case Sub.MeterSub: socket.write(encodeFrame(Sub.MeterSub, Buffer.from([0x00, 0x50]))); break;
          case Sub.Ack: socket.write(encodeFrame(Sub.Version, Buffer.from([5, 1, 6, 0]))); break;
          case Sub.StateAck: socket.write(encodeFrame(Sub.InitState, Buffer.alloc(720))); break;
          case Sub.TypeReq: socket.write(encodeFrame(Sub.TypeResp, Buffer.from([1, 0]))); break;
          case DSP_MARKER: frames.push(frame.payload); break;
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const controller = new MixerController();
  context.after(async () => {
    controller.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const waitForStatus = (expected: string) => new Promise<void>(resolve => {
    const handler = (status: string) => {
      if (status === expected) { controller.off("status", handler); resolve(); }
    };
    controller.on("status", handler);
  });
  const connected = waitForStatus("ok");
  controller.start({ host: "127.0.0.1", port: address.port, localInterface: "", reconnectMs: 500 });
  await connected;
  assert.equal(controller.connected, true);
  assert.equal(controller.values.has("/input/1/mute"), false);
  assert.throws(() => controller.write("/input/1/mute", [1], "toggle"), /unknown/);
  assert.throws(() => controller.write("/input/49/mute", [1]), /not writable/);
  controller.write("/input/1/mute", [1]);
  assert.equal(controller.values.get("/input/1/mute"), 1);

  const update = once(controller, "values");
  peer!.write(Buffer.from([0xf7, 0x07, 0x07, 0x0c, 0x00, 0x00, 0x00, 0x00]));
  await update;
  assert.equal(controller.values.get("/input/1/mute"), 0);
  assert(frames.some(frame => frame.equals(Buffer.from([0x07, 0x07, 0x0c, 0x00, 0x00, 0x01, 0x00]))));

  const scene = once(controller, "scene");
  peer!.write(Buffer.from([0xf7, 0x00, 0x02, 0x1c, 0x03, 0x00, 0xff, 0xff]));
  assert.equal((await scene)[0], 4);

  const reconnected = waitForStatus("ok");
  const disconnected = waitForStatus("disconnected");
  peer!.destroy();
  await disconnected;
  assert.equal(controller.values.size, 0);
  assert.equal(controller.connected, false);
  await reconnected;
  assert.equal(controller.connected, true);
  assert.equal(controller.values.has("/input/1/mute"), false);
});

test("invalid configuration does not open a socket", () => {
  let created = false;
  const controller = new MixerController(() => { created = true; throw new Error("Unexpected connection"); });
  controller.start({ host: "127.0.0.1", port: 0, localInterface: "", reconnectMs: 500 });
  assert.equal(created, false);
  controller.stop();
});