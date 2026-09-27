/**
 * Sprint F1.2 — opcuaDriver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/thiết bị thật.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OtTagAddress } from "../otDriver";

const tags: OtTagAddress[] = [
  { tagKey: "temp", address: "ns=2;s=Temp", dataType: "float", scale: 10, offset: 1 },
  { tagKey: "run", address: "ns=2;s=Run", dataType: "bool" },
];

describe("OpcuaDriver (mocked node-opcua)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OT_OPCUA_MONITORED_ITEMS;
  });

  function mockOpcua(readImpl: (nodes: any[]) => any, writeImpl?: (nodes: any[]) => any) {
    const session = {
      read: vi.fn(async (nodes: any[]) => readImpl(nodes)),
      write: vi.fn(async (nodes: any[]) =>
        writeImpl ? writeImpl(nodes) : nodes.map(() => ({ value: 0 })),
      ),
      close: vi.fn(async () => {}),
    };
    const client = {
      connect: vi.fn(async () => {}),
      createSession: vi.fn(async () => session),
      disconnect: vi.fn(async () => {}),
    };
    // Variant ghi lại args để test coerce; DataType là enum giả.
    class Variant {
      dataType: any;
      value: any;
      constructor(o: any) {
        this.dataType = o.dataType;
        this.value = o.value;
      }
    }
    vi.doMock("node-opcua", () => ({
      OPCUAClient: { create: vi.fn(() => client) },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant,
    }));
    return { client, session };
  }

  it("connect → readTags maps values with scale/offset; disconnect", async () => {
    const { client, session } = mockOpcua((nodes) =>
      nodes.map((n: any) => ({
        statusCode: { value: 0 },
        sourceTimestamp: new Date(),
        value: { value: n.nodeId.includes("Run") ? true : 2 },
      })),
    );

    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();

    await d.connect({ endpoint: "opc.tcp://localhost:4840" });
    expect(d.isConnected()).toBe(true);
    expect(client.connect).toHaveBeenCalled();

    const samples = await d.readTags(tags);
    expect(samples).toHaveLength(2);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    expect(temp.value).toBe(21); // 2*10+1
    expect(temp.quality).toBe("good");
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.value).toBe(true);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
    expect(session.close).toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it("F4b writeTags: good status → ok:true; inverse scale/offset applied to value", async () => {
    const { session } = mockOpcua(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });

    // temp tag: float scale 10 offset 1. write user value 21 → raw (21-1)/10 = 2.
    const res = await d.writeTags([
      { tagKey: "temp", address: "ns=2;s=Temp", value: 21, dataType: "float", scale: 10, offset: 1 },
    ]);
    expect(res[0].ok).toBe(true);
    expect(session.write).toHaveBeenCalledTimes(1);
    const sent = (session.write as any).mock.calls[0][0];
    expect(sent[0].nodeId).toBe("ns=2;s=Temp");
    expect(sent[0].attributeId).toBe(13); // AttributeIds.Value
    expect(sent[0].value.value.value).toBeCloseTo(2, 6); // inverse-scaled raw
    expect(sent[0].value.value.dataType).toBe(11); // DataType.Double
  });

  it("F4b writeTags: bool NOT inverse-scaled, coerced Boolean", async () => {
    const { session } = mockOpcua(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "run", address: "ns=2;s=Run", value: 1, dataType: "bool", scale: 99, offset: 99 },
    ]);
    expect(res[0].ok).toBe(true);
    const sent = (session.write as any).mock.calls[0][0];
    expect(sent[0].value.value.value).toBe(true);
    expect(sent[0].value.value.dataType).toBe(1); // DataType.Boolean
  });

  it("F4b writeTags: bad status code → ok:false", async () => {
    mockOpcua(
      () => [],
      (nodes) => nodes.map(() => ({ value: 0x80000000, name: "BadNodeIdUnknown" })),
    );
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "run", address: "ns=2;s=Run", value: true, dataType: "bool" },
    ]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/bad status/);
  });

  it("F4b writeTags: session.write throws → ok:false", async () => {
    const { session } = mockOpcua(() => []);
    (session.write as any).mockImplementation(async () => {
      throw new Error("write io error");
    });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "run", address: "ns=2;s=Run", value: true, dataType: "bool" },
    ]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/write io error/);
  });

  it("F4b writeTags: throws when not connected", async () => {
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(
      d.writeTags([{ tagKey: "run", address: "ns=2;s=Run", value: true }]),
    ).rejects.toThrow(/not connected/);
  });

  it("F4b writeTags: invalid nodeId → that write ok:false (parse error, no crash)", async () => {
    const { session } = mockOpcua(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "bad", address: "not-a-nodeid", value: 1, dataType: "int" },
    ]);
    expect(res[0].ok).toBe(false);
    // không node hợp lệ nào để gửi → session.write không được gọi
    expect(session.write).not.toHaveBeenCalled();
  });

  it("bad statusCode → quality bad, value null", async () => {
    mockOpcua((nodes) =>
      nodes.map(() => ({
        statusCode: { value: 0x80000000 },
        value: { value: 5 },
      })),
    );
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const [s] = await d.readTags([tags[0]]);
    expect(s.quality).toBe("bad");
    expect(s.value).toBeNull();
  });

  it("readTags throws when not connected", async () => {
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(d.readTags(tags)).rejects.toThrow(/not connected/);
  });

  // doc 22 P3 — OPC-UA monitored-item PUSH path (flag OT_OPCUA_MONITORED_ITEMS).
  function mockOpcuaWithSubscriptions(readImpl: (nodes: any[]) => any) {
    const { client, session } = mockOpcua(readImpl);
    // Add subscription support to the session + package.
    const subscription = { terminate: vi.fn(async () => {}) };
    (session as any).createSubscription2 = vi.fn(async () => subscription);
    // Each created monitored item exposes an EventEmitter-like .on("changed", cb).
    const createdItems: Array<{ on: any; fire: (dv: any) => void }> = [];
    const ClientMonitoredItem = {
      create: vi.fn(async () => {
        let handler: ((dv: any) => void) | null = null;
        const item = {
          on: (evt: string, cb: (dv: any) => void) => { if (evt === "changed") handler = cb; },
          fire: (dv: any) => handler && handler(dv),
        };
        createdItems.push(item);
        return item;
      }),
    };
    // Re-mock node-opcua to ALSO expose the subscription symbols.
    vi.doMock("node-opcua", () => ({
      OPCUAClient: { create: vi.fn(() => client) },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant: class Variant { constructor(o: any) { Object.assign(this, o); } },
      ClientSubscription: { create: vi.fn(async () => subscription) },
      ClientMonitoredItem,
      TimestampsToReturn: { Both: 2 },
      MonitoringMode: { Reporting: 1 },
    }));
    return { client, session, subscription, ClientMonitoredItem, createdItems };
  }

  it("flag ON → subscribe uses monitored items and pushes normalized samples on change", async () => {
    process.env.OT_OPCUA_MONITORED_ITEMS = "true";
    const { subscription, ClientMonitoredItem, createdItems } = mockOpcuaWithSubscriptions(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });

    const received: any[] = [];
    const handle = await d.subscribe(tags, (s) => { received.push(s); }, 1000);
    // One monitored item per tag.
    expect(ClientMonitoredItem.create).toHaveBeenCalledTimes(2);

    // Fire a change on the "temp" tag (float scale 10 offset 1): raw 2 → 21.
    createdItems[0].fire({ statusCode: { value: 0 }, sourceTimestamp: new Date(), value: { value: 2 } });
    expect(received).toHaveLength(1);
    expect(received[0].tagKey).toBe("temp");
    expect(received[0].value).toBe(21);
    expect(received[0].quality).toBe("good");

    await handle.close();
    expect(subscription.terminate).toHaveBeenCalled();
  });

  it("flag OFF (default) → subscribe stays on the poll path (no subscription created)", async () => {
    const { session } = mockOpcuaWithSubscriptions((nodes) =>
      nodes.map(() => ({ statusCode: { value: 0 }, value: { value: 3 } })),
    );
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const handle = await d.subscribe(tags, () => {}, 5000);
    // Poll path → createSubscription2 was never used.
    expect((session as any).createSubscription2).not.toHaveBeenCalled();
    await handle.close();
  });

  it("flag ON but package lacks subscription support → falls back to poll", async () => {
    process.env.OT_OPCUA_MONITORED_ITEMS = "true";
    // Plain mock WITHOUT subscription symbols.
    mockOpcua((nodes) => nodes.map(() => ({ statusCode: { value: 0 }, value: { value: 1 } })));
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    // Must not throw — returns a working (poll) handle.
    const handle = await d.subscribe(tags, () => {}, 5000);
    expect(typeof handle.close).toBe("function");
    await handle.close();
  });

  it("connect throws 'node-opcua not installed' when package missing", async () => {
    vi.doMock("node-opcua", () => {
      throw new Error("Cannot find module");
    });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(d.connect({ endpoint: "opc.tcp://x" })).rejects.toThrow(/node-opcua not installed/);
  });
});

// ── doc 81 Đợt 1B Task 12 — bảo mật / ép kiểu / cô lập theo tag / hạn đóng (gói GIẢ) ──
describe("OpcuaDriver Task 12 (mocked node-opcua)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OT_OPCUA_MONITORED_ITEMS;
  });

  function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${label}: test deadline ${ms}ms exceeded`)), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }

  function mockPkg(over: { session?: Record<string, any>; client?: Record<string, any> } = {}) {
    const session: Record<string, any> = {
      read: vi.fn(async (nodes: any[]) => nodes.map(() => ({ statusCode: { value: 0 }, value: { value: 1 } }))),
      write: vi.fn(async (nodes: any[]) => nodes.map(() => ({ value: 0 }))),
      close: vi.fn(async () => {}),
      ...over.session,
    };
    const client: Record<string, any> = {
      connect: vi.fn(async () => {}),
      createSession: vi.fn(async () => session),
      disconnect: vi.fn(async () => {}),
      ...over.client,
    };
    const cmInstances: any[] = [];
    class OPCUACertificateManager {
      opts: any;
      referenceCounter = 0;
      constructor(o: any) {
        this.opts = o;
        cmInstances.push(this);
      }
      async initialize() {}
      async dispose() {}
    }
    class Variant {
      dataType: any;
      value: any;
      constructor(o: any) {
        this.dataType = o.dataType;
        this.value = o.value;
      }
    }
    const create = vi.fn((_opts: any) => client);
    vi.doMock("node-opcua", () => ({
      OPCUAClient: { create },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant,
      MessageSecurityMode: { None: 1, Sign: 2, SignAndEncrypt: 3 },
      SecurityPolicy: {
        None: "http://opcfoundation.org/UA/SecurityPolicy#None",
        Basic256Sha256: "http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256",
        Aes128_Sha256_RsaOaep: "http://opcfoundation.org/UA/SecurityPolicy#Aes128_Sha256_RsaOaep",
        Aes256_Sha256_RsaPss: "http://opcfoundation.org/UA/SecurityPolicy#Aes256_Sha256_RsaPss",
      },
      OPCUACertificateManager,
    }));
    return { client, session, create, cmInstances };
  }

  it("unconfigured ⇒ OPCUAClient.create gets the LEGACY options only (SecurityMode None, no PKI) and warns once", async () => {
    const { create } = mockPkg();
    const sec = await import("./opcuaSecurity");
    sec.__resetOpcuaSecurityWarningForTest();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { OpcuaDriver } = await import("./opcuaDriver");
      const d = new OpcuaDriver();
      await d.connect({ endpoint: "opc.tcp://10.1.2.3:4840" });
      await d.disconnect();
      await d.connect({ endpoint: "opc.tcp://10.1.2.3:4840" });
      expect(create.mock.calls[0][0]).toEqual({ endpointMustExist: false, connectionStrategy: { maxRetry: 1 } });
      expect(warn.mock.calls.filter((c) => /securityMode not configured/.test(String(c[0])))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("securityMode=SignAndEncrypt ⇒ client created with mode/policy + a strict (non-TOFU) certificate manager rooted at OPCUA_PKI_DIR", async () => {
    const { create, cmInstances } = mockPkg();
    const saved = process.env.OPCUA_PKI_DIR;
    process.env.OPCUA_PKI_DIR = "C:/tmp/t12-pki-mock";
    try {
      const { OpcuaDriver } = await import("./opcuaDriver");
      const d = new OpcuaDriver();
      await d.connect({ endpoint: "opc.tcp://x", options: { securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256" } });
      const o = create.mock.calls[0][0];
      expect(o.securityMode).toBe(3);
      expect(o.securityPolicy).toBe("http://opcfoundation.org/UA/SecurityPolicy#Basic256Sha256");
      expect(o.clientCertificateManager).toBe(cmInstances[0]);
      expect(cmInstances[0].opts.automaticallyAcceptUnknownCertificate).toBe(false);
      expect(String(cmInstances[0].opts.rootFolder).replace(/\\/g, "/")).toBe("C:/tmp/t12-pki-mock");
      // Một tham chiếu giữ sẵn ⇒ client.disconnect() (cm.dispose) không huỷ manager dùng chung.
      expect(cmInstances[0].referenceCounter).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.OPCUA_PKI_DIR;
      else process.env.OPCUA_PKI_DIR = saved;
    }
  });

  it("contradictory security config ⇒ connect rejects with a reason BEFORE opening a client", async () => {
    const { create } = mockPkg();
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(
      d.connect({ endpoint: "opc.tcp://x", options: { securityMode: "SignAndEncrypt", securityPolicy: "None" } }),
    ).rejects.toThrow(/requires a securityPolicy/);
    expect(create).not.toHaveBeenCalled();
  });

  it("readTags: one unparseable address ⇒ only that tag bad (BadNodeIdInvalid); session.read gets the valid nodes only", async () => {
    const { session } = mockPkg();
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const out = await d.readTags([
      { tagKey: "a", address: "ns=2;s=A", dataType: "int" },
      { tagKey: "bad", address: "DB1.DBW0", dataType: "int" },
      { tagKey: "c", address: "ns=2;s=C", dataType: "int" },
    ]);
    expect(out.map((s) => s.quality)).toEqual(["good", "bad", "good"]);
    expect(out[1].statusCode).toMatch(/BadNodeIdInvalid/);
    expect(out[0].statusCode).toBeUndefined();
    expect(session.read.mock.calls[0][0].map((n: any) => n.nodeId)).toEqual(["ns=2;s=A", "ns=2;s=C"]);
  });

  it("writeTags: Variant built with the NODE's builtin type (Float=10), not the legacy Double", async () => {
    const getBuiltInDataType = vi.fn(async () => 10);
    const { session } = mockPkg({ session: { getBuiltInDataType } });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([{ tagKey: "t", address: "ns=2;s=T", value: 3.5, dataType: "float" }]);
    expect(res[0]).toEqual({ tagKey: "t", ok: true });
    expect(session.write.mock.calls[0][0][0].value.value).toMatchObject({ dataType: 10, value: 3.5 });
    // cache theo nodeId
    await d.writeTags([{ tagKey: "t", address: "ns=2;s=T", value: 4, dataType: "float" }]);
    expect(getBuiltInDataType).toHaveBeenCalledTimes(1);
  });

  it("writeTags: out of range for the node type ⇒ ok:false, nothing sent; DataType read failure isolates that write", async () => {
    const getBuiltInDataType = vi.fn(async (n: string) => {
      if (n === "ns=2;s=Gone") throw new Error("cannot read DataType Attribute BadNodeIdUnknown (0x80340000)");
      return 3; // Byte
    });
    const { session } = mockPkg({ session: { getBuiltInDataType } });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "big", address: "ns=2;s=B", value: 300, dataType: "int" },
      { tagKey: "gone", address: "ns=2;s=Gone", value: 1, dataType: "int" },
      { tagKey: "okk", address: "ns=2;s=B2", value: 7, dataType: "int" },
    ]);
    expect(res.map((r) => r.ok)).toEqual([false, false, true]);
    expect(res[0].error).toMatch(/out of range for Byte/);
    expect(res[1].error).toMatch(/BadNodeIdUnknown/);
    expect(session.write.mock.calls[0][0].map((n: any) => n.nodeId)).toEqual(["ns=2;s=B2"]);
  });

  it("writeTags: BadTypeMismatch drops the cached DataType so the next write re-reads it", async () => {
    const getBuiltInDataType = vi.fn(async () => 4);
    const write = vi.fn(async (nodes: any[]) => nodes.map(() => ({ value: 0x80740000, name: "BadTypeMismatch" })));
    mockPkg({ session: { getBuiltInDataType, write } });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const r1 = await d.writeTags([{ tagKey: "t", address: "ns=2;s=T", value: 1, dataType: "int" }]);
    expect(r1[0].ok).toBe(false);
    await d.writeTags([{ tagKey: "t", address: "ns=2;s=T", value: 1, dataType: "int" }]);
    expect(getBuiltInDataType).toHaveBeenCalledTimes(2);
  });

  it("disconnect() is bounded even when session.close / client.disconnect never settle", async () => {
    mockPkg({
      session: { close: vi.fn(() => new Promise(() => {})) },
      client: { disconnect: vi.fn(() => new Promise(() => {})) },
    });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const t0 = Date.now();
    await withDeadline(d.disconnect(), 4000, "disconnect");
    expect(Date.now() - t0).toBeLessThan(2600);
    expect(d.isConnected()).toBe(false);
  });

  it("failed connect cleans up with a bounded client.disconnect (never hangs)", async () => {
    mockPkg({
      client: {
        connect: vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
        disconnect: vi.fn(() => new Promise(() => {})),
      },
    });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    const t0 = Date.now();
    await expect(withDeadline(d.connect({ endpoint: "opc.tcp://x" }), 4000, "connect")).rejects.toThrow(/ECONNREFUSED/);
    expect(Date.now() - t0).toBeLessThan(2600);
  });
});
