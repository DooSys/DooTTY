# Distribution Windows

## État actuel

DooTTY 0.0.5 est un EXE Windows x64 sans installateur. Les préférences sont dans
`%APPDATA%\DooTTY\config.json`. Déplacer l'EXE ne déplace pas ces préférences.
Le profil WebView2 utilise un emplacement local Windows séparé.

La version actuelle n'implémente ni option `--portable`, ni fichier de configuration
à côté de l'EXE, ni migration entre deux modes. Il ne faut pas la présenter comme
un mode portable autonome.

## Proposition pour une évolution ultérieure

| Mode | Programme | Préférences |
|---|---|---|
| Installation par utilisateur | `%LOCALAPPDATA%\Programs\DooTTY\` | `%APPDATA%\DooTTY\config.json` |
| Portable explicite | Dossier choisi et accessible en écriture | Sous-dossier `data\` à côté de l'EXE |

Un installateur NSIS Tauri permettrait les raccourcis et la désinstallation. Une
installation par utilisateur évite une élévation générale de l'application.
Un mode portable devrait être activé explicitement et isoler aussi les données
locales/WebView2 nécessaires, sans écrire silencieusement dans le profil Windows.
Un dossier non inscriptible doit produire une erreur claire.

Les deux modes devraient utiliser le même format de préférences. La migration
serait explicite, et une mise à jour ne remplacerait pas la configuration. Ces
choix sont une proposition ; ils ne changent pas le stockage de la version actuelle.

Référence : [installateurs Windows Tauri](https://v2.tauri.app/distribute/windows-installer/).
