<!--
  WS-F1-T3 — heat.exe transform (wired via St4i.Installer.wixproj's HarvestDirectory/@Transforms)
  applied to the auto-harvested publish-desktop\** component fragment.

  Package.wxs installs St4i.DesktopShell.exe and engine\St4i.EngineApi.exe itself, as two explicit
  <Component>/<File> blocks (not harvested) — the shell exe carries the Start Menu + Startup-folder
  <Shortcut> children, and the engine exe carries the optional <ServiceInstall>/<ServiceControl>
  pair. Windows Installer requires the file that becomes a service's binary to be the KeyPath file of
  the SAME component as its ServiceInstall row, and a shortcut nested in a <File> needs a real,
  hand-authored component to attach to — neither is possible against heat's auto-generated,
  non-deterministic component/file Ids. Without this transform, the bulk harvest below would ALSO
  install these same two files under a second, different component, which is invalid (two components
  both claiming the same installed target path).

  Match by @Source suffix, not @Name — heat's directory harvester omits the File/@Name attribute
  entirely when the name can be inferred from @Source (confirmed empirically), so a `@Name=` match
  silently never fires.

  GĐ3 WI-6 item 2 — match the path-separator-qualified SUFFIX of @Source, not a bare substring:
  `contains(@Source, 'St4i.EngineApi.exe')` would also match a longer, unrelated harvested filename
  that merely happens to embed that text anywhere (e.g. a hypothetical
  "Some.Other.St4i.EngineApi.exe.config" or "Foo.St4i.EngineApi.exe"), silently dropping it from the
  harvest along with the two files this transform actually intends to exclude. The
  `substring(@Source, string-length(@Source) - string-length($needle) + 1) = $needle` idiom is the
  standard XSLT 1.0 replacement for `ends-with()` (not available until XPath 2.0); including the
  leading `\` in $needle means the match requires a real path-separator boundary immediately before
  the filename, so a longer basename that merely ENDS with "St4i.EngineApi.exe" as a substring (with
  no separator immediately before it) still cannot match.

  ══════════════════════════════════════════════════════════════════════════════════════════════════
  🔴 BN-1, 2026-08-24 — docs/owner-decisions.md item 46, OWNER'S RULING OF 2026-08-23:
  "HARVEST EXCLUDES BY NAME." A SECOND POPULATION IS DROPPED HERE, and it is dropped for the opposite
  reason from the two exes above.

  The two exes are excluded because Package.wxs authors them TWICE OVER. The five names below are
  excluded because NOTHING SHOULD AUTHOR THEM AT ALL: they are the files the running product WRITES
  into its own directory, so whatever a build box's own runs happened to leave beside the binary is
  what the harvest picks up and ships to a customer. `build-installer.ps1 -SkipDotnetPublish` is the
  branch where that becomes reachable — it skips the `Remove-Item -Recurse -Force publish-desktop`
  that the ordinary path performs, and the harvest reads THE WHOLE DIRECTORY. The ruling is that the
  exclusion must not depend on that delete: a delete protects only the arm that runs it, and the flag
  exists precisely to skip that arm.

  🔴 WHERE THE FIVE NAMES COME FROM, AND WHY NOT FROM WHAT IS ON DISK TODAY (§8.1(a)). They are not
  the files that happened to be sitting in publish-desktop\ when this was written — a list fitted to
  today's residue is a list that breaks at the next name. They are derived from WHO AUTHORS THEM: the
  three stores whose LegacyRoot() is AppContext.BaseDirectory (or a subfolder of it), i.e. the three
  and only three stores that ever persisted beside the binary, each contributing its own persisted-
  filename constants:

      src/St4i.EdgeCore/Config/ProductConfigStore.cs   -> products.json, recipes.json
      src/St4i.EngineApi/Config/SimulatedEcosystem.cs  -> ecosystem-products.json,
                                                          ecosystem-recipes.json
      src/St4i.EdgeCore/Config/MachineConfigStore.cs   -> machine-operating-config.json

  🔴 XSLT CANNOT READ C#, SO THIS LIST IS A COPY — and a copy that nothing checks is the rot this
  repository keeps paying for. The binding is a test, not a comment:
  tests/St4i.EdgeCore.Tests/InstallerHarvestExclusionTests.cs re-derives the set from those three
  sources on every run and requires it to EQUAL the needles below. Add a sixth persisted file to any
  of the three stores and that test goes red naming the file, instead of this transform silently
  shipping it.

  🔴 THE OTHER BANK, because a filter is two claims and stating one is stating half. A pattern wide
  enough to be safe against tomorrow's residue is a pattern that can drop a REAL product asset out of
  the MSI — silently, because the MSI still builds and still installs, just without the file. That is
  why these are five exact, separator-qualified basenames and not `*.json` or `*products*`: the
  published payload's own JSON — engine\fleet.json, engine\connectors.json, engine\mapping\*.json,
  engine\St4i.EngineApi.staticwebassets.endpoints.json — is shipped by St4i.EngineApi.csproj's own
  <None>/<Content> items, and NONE of those five names appears among them (measured at BN-1: the
  csproj ships fleet.json, connectors.json, mapping\*.json, web\dist\** and the board .png assets).
  The same test asserts that bank too: every one of those payload files must SURVIVE the transform.

  Note on the leading separator: the `products.json` needle cannot match `ecosystem-products.json`,
  because the character before `products.json` there is `-`, not a path separator. The two pairs are
  therefore four independent needles, not two with wildcards.

  🔴 WHAT THIS FILE IS STILL CALLED, AND WHY IT WAS NOT RENAMED. The name now under-describes the
  content. It is kept anyway: the wixproj wires this in by FILENAME through HarvestDirectory's
  Transforms metadata, a mis-wired transform fails SILENTLY (the harvest simply stops excluding and
  the MSI still builds), and that silent-failure mode is the exact class of defect this change exists
  to close — so it is not a thing to spend on a better filename. The wiring is pinned by the same
  test file instead.
  ══════════════════════════════════════════════════════════════════════════════════════════════════
-->
<xsl:stylesheet version="1.0"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:wix="http://wixtoolset.org/schemas/v4/wxs">
  <xsl:output method="xml" indent="yes" />

  <!-- Identity transform: copy everything through unchanged by default. -->
  <xsl:template match="@*|node()">
    <xsl:copy>
      <xsl:apply-templates select="@*|node()" />
    </xsl:copy>
  </xsl:template>

  <!-- Drop the harvested <Component> wrapping either special exe, or any operator-authorable store
       file. XSLT 1.0 has no variables usable inside a match pattern, so the predicate is spelled out
       once here and once on the ComponentRef template below — the two must stay identical, and
       InstallerHarvestExclusionTests reddens if only one of them is edited. -->
  <xsl:template match="wix:Component[wix:File[
      substring(@Source, string-length(@Source) - string-length('\St4i.EngineApi.exe') + 1) = '\St4i.EngineApi.exe' or
      substring(@Source, string-length(@Source) - string-length('\St4i.DesktopShell.exe') + 1) = '\St4i.DesktopShell.exe' or
      substring(@Source, string-length(@Source) - string-length('\products.json') + 1) = '\products.json' or
      substring(@Source, string-length(@Source) - string-length('\recipes.json') + 1) = '\recipes.json' or
      substring(@Source, string-length(@Source) - string-length('\ecosystem-products.json') + 1) = '\ecosystem-products.json' or
      substring(@Source, string-length(@Source) - string-length('\ecosystem-recipes.json') + 1) = '\ecosystem-recipes.json' or
      substring(@Source, string-length(@Source) - string-length('\machine-operating-config.json') + 1) = '\machine-operating-config.json' or
      substring(@Source, string-length(@Source) - string-length('\run-exhibition.bat') + 1) = '\run-exhibition.bat']]" />

  <!-- Drop the matching <ComponentRef> in the harvested ComponentGroup fragment (same-document
       lookup — the dropped Component's @Id is still resolvable here since template matching for
       exclusion doesn't remove it from the XPath data model, only from the output). -->
  <xsl:template match="wix:ComponentRef[@Id = //wix:Component[wix:File[
      substring(@Source, string-length(@Source) - string-length('\St4i.EngineApi.exe') + 1) = '\St4i.EngineApi.exe' or
      substring(@Source, string-length(@Source) - string-length('\St4i.DesktopShell.exe') + 1) = '\St4i.DesktopShell.exe' or
      substring(@Source, string-length(@Source) - string-length('\products.json') + 1) = '\products.json' or
      substring(@Source, string-length(@Source) - string-length('\recipes.json') + 1) = '\recipes.json' or
      substring(@Source, string-length(@Source) - string-length('\ecosystem-products.json') + 1) = '\ecosystem-products.json' or
      substring(@Source, string-length(@Source) - string-length('\ecosystem-recipes.json') + 1) = '\ecosystem-recipes.json' or
      substring(@Source, string-length(@Source) - string-length('\machine-operating-config.json') + 1) = '\machine-operating-config.json' or
      substring(@Source, string-length(@Source) - string-length('\run-exhibition.bat') + 1) = '\run-exhibition.bat']]/@Id]" />
</xsl:stylesheet>
