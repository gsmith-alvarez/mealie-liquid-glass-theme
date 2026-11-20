{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.mealie.liquidGlass;
  frontend =
    cfg.basePackage.frontend
      or (throw "services.mealie.liquidGlass.basePackage must expose a frontend attribute");
  themedFrontend = pkgs.runCommand "mealie-liquid-glass-frontend" { } ''
    cp -r ${frontend} "$out"
    test -f "$out/index.html"
    chmod -R u+w "$out"
    cp ${../liquid-glass.css} "$out/liquid-glass.css"
    token=$(sha256sum "$out/liquid-glass.css" | cut -c1-10)
    while IFS= read -r -d "" html; do
      grep -q '</head>' "$html"
      substituteInPlace "$html" --replace-fail '</head>' \
        "<link rel=\"stylesheet\" href=\"/liquid-glass.css?v=$token\" id=\"liquid-glass-theme\"></head>"
    done < <(find "$out" -type f -name '*.html' -print0)
  '';
  themedPackage = pkgs.symlinkJoin {
    name = "mealie-liquid-glass";
    paths = [ cfg.basePackage ];
    passthru.frontend = themedFrontend;
    inherit (cfg.basePackage) meta;
    postBuild = ''
      rm "$out/bin/mealie"
      cp ${cfg.basePackage}/bin/mealie "$out/bin/mealie"
      chmod u+w "$out/bin/mealie"
      substituteInPlace "$out/bin/mealie" \
        --replace-fail '${frontend}' '${themedFrontend}'
    '';
  };
  colors = {
    THEME_LIGHT_PRIMARY = "#E87500";
    THEME_LIGHT_ACCENT = "#FFAD4D";
    THEME_LIGHT_SECONDARY = "#1F2937";
    THEME_LIGHT_SUCCESS = "#22C55E";
    THEME_LIGHT_INFO = "#94A3B8";
    THEME_LIGHT_WARNING = "#F59E0B";
    THEME_LIGHT_ERROR = "#F43F5E";
    THEME_DARK_PRIMARY = "#E87500";
    THEME_DARK_ACCENT = "#FFAD4D";
    THEME_DARK_SECONDARY = "#030712";
    THEME_DARK_SUCCESS = "#22C55E";
    THEME_DARK_INFO = "#94A3B8";
    THEME_DARK_WARNING = "#F59E0B";
    THEME_DARK_ERROR = "#FB7185";
  };
in
{
  options.services.mealie.liquidGlass = {
    enable = lib.mkEnableOption "the Liquid Glass theme for Mealie";
    basePackage = lib.mkOption {
      type = lib.types.package;
      default = pkgs.mealie;
      defaultText = lib.literalExpression "pkgs.mealie";
      description = "Mealie package to theme; it must expose a frontend attribute.";
    };
  };

  config = lib.mkIf cfg.enable {
    services.mealie.package = themedPackage;
    services.mealie.settings = lib.mapAttrs (_: lib.mkDefault) colors;
  };
}
