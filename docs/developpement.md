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
npm run build:installer
```

Résultat : `src-tauri/target/release/DooTTY.exe`. Le workflow Windows produit aussi
l’installeur comprenant les licences. NSIS **3.11** doit être installé
(`choco install nsis.install --version=3.11.0`). Le résultat final est
`.local/releases/<version>/DooTTY-<version>-setup.exe`. `npm run desktop` lance le développement natif.
`npm run dev` donne un aperçu navigateur sans connexion WSL ni sauvegarde native.

Pour inspecter un binaire compilé, avec Python 3 :

```powershell
python scripts/verify-windows.py --binary src-tauri/target/release/DooTTY.exe
```

Les fichiers sont générés sous `.local/releases/<version>/`, exclus de Git. Pillow
n'est nécessaire que pour régénérer les icônes depuis leur source graphique
`assets/branding/app-icon-transparent-source.png`, via `scripts/make-icons.py`.
Les formats consommés sont l'ICO, les PNG 32/128 px et l'image d'interface 512 px.

Voir [la validation](validation.md), [les traductions](../TRANSLATING.md) et
[les changements](../CHANGELOG.md). Les notes de travail, configurations personnelles,
SDK et outils de compilation locaux restent exclus du dépôt.

## Livraison

Après validation et commit des changements, un tag `v<version>` déclenche le
workflow Windows. Le tag doit correspondre à `package.json`, Cargo et Tauri.
Le workflow vérifie cette cohérence, exécute les tests et produit une version
GitHub **en brouillon**. Publiez-la depuis GitHub après vos essais Windows.
Le workflow ne signe pas encore les exécutables.

Le script `scripts/smoke-installer.ps1` vérifie sur une machine Windows de test
sans installation DooTTY préexistante : extraction portable, réextraction sans
perte de configuration, installation, réinstallation, désinstallation conservant
les réglages et suppression facultative du cache/préférences. Il ne lance aucune
session WSL. Les dialogues, le raccourci bureau et la fermeture d’une session restent à
vérifier sur un poste Windows interactif.
