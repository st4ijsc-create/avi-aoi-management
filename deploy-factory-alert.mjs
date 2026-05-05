#!/usr/bin/env node
/**
 * Deploy script for FactoryAlertSystem APK releases
 * 
 * Usage:
 *   node deploy-factory-alert.mjs                          # Auto-detect latest APK
 *   node deploy-factory-alert.mjs --version 1.1.0          # Override version
 *   node deploy-factory-alert.mjs --changelog "Fix bug X"  # Add changelog
 *   node deploy-factory-alert.mjs --mandatory              # Mark as mandatory update
 *   node deploy-factory-alert.mjs --min-version-code 2     # Set minimum required version
 * 
 * This script:
 *   1. Reads version from FactoryAlertSystem/android/app/build.gradle
 *   2. Copies the release APK to uploads/factory-alert-releases/
 *   3. Creates/updates version.json with correct metadata
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// Paths
const BUILD_GRADLE = path.join(ROOT, "FactoryAlertSystem/android/app/build.gradle");
const APK_OUTPUT_DIR = path.join(ROOT, "FactoryAlertSystem/android/app/build/outputs/apk/release");
const RELEASES_DIR = path.join(ROOT, "uploads/factory-alert-releases");

// Parse command line args
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    version: null,
    versionCode: null,
    changelog: [],
    mandatory: false,
    minVersionCode: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--version":
        result.version = args[++i];
        break;
      case "--version-code":
        result.versionCode = parseInt(args[++i], 10);
        break;
      case "--changelog":
        result.changelog.push(args[++i]);
        break;
      case "--mandatory":
        result.mandatory = true;
        break;
      case "--min-version-code":
        result.minVersionCode = parseInt(args[++i], 10);
        break;
    }
  }

  return result;
}

// Read version info from build.gradle
function readBuildGradle() {
  const content = fs.readFileSync(BUILD_GRADLE, "utf-8");

  const versionNameMatch = content.match(/versionName\s+["'](.+?)["']/);
  const versionCodeMatch = content.match(/versionCode\s+(\d+)/);

  if (!versionNameMatch || !versionCodeMatch) {
    throw new Error("Could not parse versionName/versionCode from build.gradle");
  }

  return {
    version: versionNameMatch[1],
    versionCode: parseInt(versionCodeMatch[1], 10),
  };
}

// Find the latest APK in output directory
function findLatestApk() {
  if (!fs.existsSync(APK_OUTPUT_DIR)) {
    throw new Error(`APK output directory not found: ${APK_OUTPUT_DIR}\nRun the release build first.`);
  }

  const apkFiles = fs.readdirSync(APK_OUTPUT_DIR)
    .filter(f => f.endsWith(".apk"))
    .map(f => ({
      name: f,
      path: path.join(APK_OUTPUT_DIR, f),
      mtime: fs.statSync(path.join(APK_OUTPUT_DIR, f)).mtime,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (apkFiles.length === 0) {
    throw new Error(`No APK files found in: ${APK_OUTPUT_DIR}\nRun the release build first.`);
  }

  return apkFiles[0];
}

// Main deploy function
function deploy() {
  console.log("=".repeat(60));
  console.log(" FactoryAlertSystem APK Deploy");
  console.log("=".repeat(60));

  const args = parseArgs();

  // 1. Read version from build.gradle
  const gradle = readBuildGradle();
  const version = args.version || gradle.version;
  const versionCode = args.versionCode || gradle.versionCode;
  console.log(`\n[1/4] Version: ${version} (code: ${versionCode})`);

  // 2. Find latest APK
  const apk = findLatestApk();
  const apkSize = (fs.statSync(apk.path).size / (1024 * 1024)).toFixed(2);
  console.log(`[2/4] Found APK: ${apk.name} (${apkSize} MB)`);
  console.log(`      Built: ${apk.mtime.toLocaleString()}`);

  // 3. Copy APK to releases folder
  if (!fs.existsSync(RELEASES_DIR)) {
    fs.mkdirSync(RELEASES_DIR, { recursive: true });
  }

  const targetApkName = `FactoryAlertSystem-v${version}.apk`;
  const targetApkPath = path.join(RELEASES_DIR, targetApkName);

  fs.copyFileSync(apk.path, targetApkPath);
  console.log(`[3/4] Copied APK → uploads/factory-alert-releases/${targetApkName}`);

  // 4. Create/update version.json
  const changelog = args.changelog.length > 0
    ? args.changelog
    : [`Release v${version}`];

  const versionData = {
    version,
    versionCode,
    releaseDate: new Date().toISOString().split("T")[0],
    apkUrl: `download/${targetApkName}`,
    changelog,
    mandatory: args.mandatory,
    ...(args.minVersionCode != null ? { minVersionCode: args.minVersionCode } : {}),
  };

  const versionJsonPath = path.join(RELEASES_DIR, "version.json");
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2), "utf-8");
  console.log(`[4/4] Updated version.json`);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log(" Deploy Complete!");
  console.log("=".repeat(60));
  console.log(`  Version:     ${version} (code: ${versionCode})`);
  console.log(`  APK:         ${targetApkName} (${apkSize} MB)`);
  console.log(`  Mandatory:   ${args.mandatory ? "YES" : "No"}`);
  console.log(`  Changelog:   ${changelog.join("; ")}`);
  console.log("");
  console.log("  App update URL (set in FactoryAlertSystem Settings):");
  console.log("  → http://<SERVER_IP>:3000/api/factory-alert");
  console.log("");
  console.log("  Test endpoint:");
  console.log("  → http://localhost:3000/api/factory-alert/version.json");
  console.log("=".repeat(60));
}

deploy();
