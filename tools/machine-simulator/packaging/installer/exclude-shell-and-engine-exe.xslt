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

  <!-- Drop the harvested <Component> wrapping either special exe. -->
  <xsl:template match="wix:Component[wix:File[
      contains(@Source, 'St4i.EngineApi.exe') or
      contains(@Source, 'St4i.DesktopShell.exe')]]" />

  <!-- Drop the matching <ComponentRef> in the harvested ComponentGroup fragment (same-document
       lookup — the dropped Component's @Id is still resolvable here since template matching for
       exclusion doesn't remove it from the XPath data model, only from the output). -->
  <xsl:template match="wix:ComponentRef[@Id = //wix:Component[wix:File[
      contains(@Source, 'St4i.EngineApi.exe') or
      contains(@Source, 'St4i.DesktopShell.exe')]]/@Id]" />
</xsl:stylesheet>
