# Développer DooTTY

Depuis une copie des sources, pour compiler sous Windows : Node.js **26.13.x LTS**, npm **12.2.1** dans la branche
12, Rust MSVC **1.99.1**, outils C++ Visual Studio, SDK Windows et WebView2.
Voir les [prérequis Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run check:public
npm run check:translations
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run build:windows
```

Résultat : `src-tauri/target/release/DooTTY.exe`. Le workflow Windows produit aussi
une archive comprenant les licences. `npm run desktop` lance le développement natif.
`npm run dev` donne un aperçu navigateur sans connexion WSL ni sauvegarde native.

Pour inspecter puis empaqueter un binaire compilé, avec Python 3 :

```powershell
python scripts/package-test.py --verify-only --binary src-tauri/target/release/DooTTY.exe
python scripts/package-test.py --binary src-tauri/target/release/DooTTY.exe
```

Les fichiers sont générés sous `.local/releases/<version>/`, exclus de Git. Pillow
n'est nécessaire que pour régénérer les icônes depuis leur source graphique
`assets/branding/app-icon-transparent-source.png`, via `scripts/make-icons.py`.
Les formats consommés sont l'ICO, les PNG 32/128 px et l'image d'interface 512 px.

Voir [la validation](validation.md), [les traductions](../TRANSLATING.md) et
[les changements](../CHANGELOG.md). Les notes de travail, configurations personnelles,
SDK et outils de compilation locaux restent exclus du dépôt.
