{
  description = "Liquid Glass theme integration for Mealie";

  outputs = _: {
    nixosModules.default = import ./nix/module.nix;
  };
}
