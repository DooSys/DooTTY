# Composants tiers

Le code et les documents propres à DooTTY sont sous [MIT](LICENSE), copyright
2026 DooSys. Cette licence ne remplace pas celles des dépendances, logos et ressources tiers.

## Logiciels

L'[inventaire figé](licenses/dependencies.json) contient les versions, expressions
de licence, sources et noms des notices. Les [textes complets](THIRD_PARTY_NOTICES.txt)
accompagnent les archives binaires. L'inventaire couvre le graphe Rust résolu pour
Windows x64, outils de compilation compris, et les dépendances JavaScript d'exécution.
Il ne prétend pas que tous ces paquets sont liés dans le binaire.

| Composant direct | Licence déclarée |
|---|---|
| Tauri, API JavaScript et CLI | MIT OR Apache-2.0 |
| xterm.js et addons fit/search | MIT |
| i18next | MIT — [notice](licenses/i18next-MIT.txt) |
| portable-pty | MIT |
| arboard | MIT OR Apache-2.0 |
| windows-sys | MIT OR Apache-2.0 |
| winreg | MIT |
| serde / serde_json | MIT OR Apache-2.0 |
| TypeScript | Apache-2.0 |
| Vite / Vitest | MIT |

Les sources exactes des paquets Rust sont accessibles par les liens crates.io de
l'inventaire. Les textes de licence absents des archives de certains paquets ont
été récupérés depuis leurs sources amont et sont conservés avec leur provenance
et leur empreinte dans [licenses/supplemental/sources.json](licenses/supplemental/sources.json).
Le chargeur statique WebView2 du SDK Microsoft conserve ses propres conditions,
incluses dans les notices ; le runtime WebView2 du poste n'est pas redistribué.
Les bibliothèques système Windows et les outils de compilation suivent également
leurs conditions respectives. Aucune police Microsoft n'est fournie avec DooTTY.

Pour régénérer l'inventaire après un changement de dépendances :

```sh
cargo metadata --locked --format-version 1 --features custom-protocol --filter-platform x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml > .local/windows-metadata.json
python scripts/update-notices.py --metadata .local/windows-metadata.json
```

Créer `.local/` au préalable et installer les dépendances npm. Le fichier de
métadonnées est un fichier de développement privé : seuls l'inventaire sans
chemins locaux et les notices sont destinés au dépôt. Les outils de développement
JavaScript ne sont pas embarqués dans l'application ; leurs conditions sont
accessibles dans leurs paquets installés et le fichier de verrouillage.

## Graphismes

Le logo DooTTY a été fourni pour le projet. Sa source transparente est
`assets/branding/app-icon-transparent-source.png` ; `scripts/make-icons.py` produit
les formats d'application. Les SVG de navigation sont propres au projet.

Les neuf icônes Linux viennent de Simple Icons à une révision figée. Les sources,
attributions et conditions par marque sont dans
[licenses/distribution-icons.md](licenses/distribution-icons.md). La collection est
CC0-1.0 ; les logos Debian et Rocky Linux conservent leurs licences CC-BY-SA-3.0 et
CC-BY-SA-4.0. Les tracés sont inchangés ; les couleurs de remplissage sont adaptées
à l'affichage. Les marques restent celles de leurs détenteurs.

Les palettes Campbell, Dark+ et Solarized Dark reprennent des valeurs publiées
par Windows Terminal sous MIT : [notice Microsoft](licenses/windows-terminal-MIT.txt).
Windows Terminal est aussi une référence d'interface. Aucun code de Codex ou de
MobaXterm n'est intégré au projet.
