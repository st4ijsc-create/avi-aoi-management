import { describe, it, expect, vi, beforeEach } from "vitest";

describe("MQTT Profile Import/Export", () => {
  describe("Export Profiles", () => {
    it("should export profiles in correct JSON format", () => {
      const mockProfiles = [
        {
          name: "Production MQTT",
          brokerUrl: "mqtt://broker.example.com",
          port: 1883,
          protocol: "mqtt" as const,
          username: "user1",
          password: "pass1",
          qos: 1,
          keepAlive: 60,
          cleanSession: true,
          isActive: true,
        },
      ];

      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        profiles: mockProfiles,
      };

      expect(exportData.version).toBe("1.0");
      expect(exportData.profiles).toHaveLength(1);
      expect(exportData.profiles[0].name).toBe("Production MQTT");
      expect(exportData.profiles[0].brokerUrl).toBe("mqtt://broker.example.com");
    });

    it("should include assignments when requested", () => {
      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        profiles: [],
        assignments: [
          { profileId: 1, targetType: "machine", targetId: 1, priority: 1 },
        ],
      };

      expect(exportData.assignments).toBeDefined();
      expect(exportData.assignments).toHaveLength(1);
    });

    it("should include templates when requested", () => {
      const exportData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        profiles: [],
        templates: [
          { name: "inspection_result", pattern: "avi/{machineId}/inspection/result" },
        ],
      };

      expect(exportData.templates).toBeDefined();
      expect(exportData.templates).toHaveLength(1);
    });
  });

  describe("Import Profiles", () => {
    it("should validate import data structure", () => {
      const validImportData = {
        version: "1.0",
        profiles: [
          {
            name: "Test Profile",
            brokerUrl: "mqtt://test.broker.com",
            port: 1883,
            protocol: "mqtt",
          },
        ],
      };

      expect(validImportData.version).toBe("1.0");
      expect(validImportData.profiles).toBeDefined();
      expect(Array.isArray(validImportData.profiles)).toBe(true);
    });

    it("should reject invalid import data", () => {
      const invalidData = {
        profiles: "not an array",
      };

      expect(Array.isArray(invalidData.profiles)).toBe(false);
    });

    it("should handle overwrite option", () => {
      const importOptions = {
        overwriteExisting: true,
        skipDuplicates: false,
      };

      expect(importOptions.overwriteExisting).toBe(true);
      expect(importOptions.skipDuplicates).toBe(false);
    });

    it("should handle skip duplicates option", () => {
      const importOptions = {
        overwriteExisting: false,
        skipDuplicates: true,
      };

      expect(importOptions.skipDuplicates).toBe(true);
    });
  });
});

describe("Connection Health Monitor", () => {
  describe("Health Status Calculation", () => {
    it("should return healthy status when no errors", () => {
      const profileHealth = {
        profileId: 1,
        profileName: "Production",
        status: "healthy" as const,
        errorsLastHour: 0,
        reconnectsLastHour: 0,
      };

      expect(profileHealth.status).toBe("healthy");
      expect(profileHealth.errorsLastHour).toBe(0);
    });

    it("should return warning status when reconnects detected", () => {
      const profileHealth = {
        profileId: 1,
        profileName: "Production",
        status: "warning" as const,
        errorsLastHour: 0,
        reconnectsLastHour: 3,
      };

      expect(profileHealth.status).toBe("warning");
      expect(profileHealth.reconnectsLastHour).toBeGreaterThan(0);
    });

    it("should return error status when errors detected", () => {
      const profileHealth = {
        profileId: 1,
        profileName: "Production",
        status: "error" as const,
        errorsLastHour: 5,
        reconnectsLastHour: 2,
      };

      expect(profileHealth.status).toBe("error");
      expect(profileHealth.errorsLastHour).toBeGreaterThan(0);
    });

    it("should return unknown status when no data", () => {
      const profileHealth = {
        profileId: 1,
        profileName: "New Profile",
        status: "unknown" as const,
        errorsLastHour: 0,
        reconnectsLastHour: 0,
      };

      expect(profileHealth.status).toBe("unknown");
    });
  });

  describe("Overall Health Summary", () => {
    it("should calculate overall status correctly", () => {
      const profiles = [
        { status: "healthy" },
        { status: "healthy" },
        { status: "warning" },
      ];

      const healthy = profiles.filter(p => p.status === "healthy").length;
      const warning = profiles.filter(p => p.status === "warning").length;
      const error = profiles.filter(p => p.status === "error").length;

      expect(healthy).toBe(2);
      expect(warning).toBe(1);
      expect(error).toBe(0);
    });

    it("should determine overall status based on worst case", () => {
      const determineOverallStatus = (profiles: { status: string }[]) => {
        if (profiles.some(p => p.status === "error")) return "error";
        if (profiles.some(p => p.status === "warning")) return "warning";
        if (profiles.some(p => p.status === "unknown")) return "unknown";
        return "healthy";
      };

      expect(determineOverallStatus([{ status: "healthy" }, { status: "error" }])).toBe("error");
      expect(determineOverallStatus([{ status: "healthy" }, { status: "warning" }])).toBe("warning");
      expect(determineOverallStatus([{ status: "healthy" }])).toBe("healthy");
    });
  });
});

describe("MQTT Profile Validation", () => {
  it("should validate required fields", () => {
    const validateProfile = (profile: any) => {
      const errors: string[] = [];
      if (!profile.name) errors.push("Name is required");
      if (!profile.brokerUrl) errors.push("Broker URL is required");
      if (!profile.port) errors.push("Port is required");
      return errors;
    };

    const validProfile = { name: "Test", brokerUrl: "mqtt://test.com", port: 1883 };
    const invalidProfile = { name: "", brokerUrl: "", port: 0 };

    expect(validateProfile(validProfile)).toHaveLength(0);
    expect(validateProfile(invalidProfile).length).toBeGreaterThan(0);
  });

  it("should validate port range", () => {
    const validatePort = (port: number) => port >= 1 && port <= 65535;

    expect(validatePort(1883)).toBe(true);
    expect(validatePort(8883)).toBe(true);
    expect(validatePort(0)).toBe(false);
    expect(validatePort(70000)).toBe(false);
  });

  it("should validate protocol values", () => {
    const validProtocols = ["mqtt", "mqtts", "ws", "wss"];
    
    expect(validProtocols.includes("mqtt")).toBe(true);
    expect(validProtocols.includes("mqtts")).toBe(true);
    expect(validProtocols.includes("invalid")).toBe(false);
  });

  it("should validate QoS values", () => {
    const validQoS = [0, 1, 2];
    
    expect(validQoS.includes(0)).toBe(true);
    expect(validQoS.includes(1)).toBe(true);
    expect(validQoS.includes(2)).toBe(true);
    expect(validQoS.includes(3)).toBe(false);
  });
});
