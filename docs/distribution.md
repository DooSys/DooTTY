# Distribution Windows

DooTTY 0.0.6 utilise un seul fichier `DooTTY-0.0.6-setup.exe` pour les deux modes.
Une interface Windows standard et claire, avec un seul logo dans la barre de titre
et l’accent bleu DooTTY, propose un parcours court,
en français ou en anglais selon Windows.

| Mode | Programme | Préférences | Cache WebView2 |
|---|---|---|---|
| Installer pour moi | `%LOCALAPPDATA%\Programs\DooTTY` | `%APPDATA%\DooTTY\config.json` | `%LOCALAPPDATA%\com.doosys.dootty` |
| Portable | Dossier choisi | `data\config.json` à côté de l’EXE | `data\webview2` |

## Installation et portable

L’installation est personnelle, sans élévation générale. Elle crée le raccourci
Démarrer et l’entrée de désinstallation Windows. Une case facultative en fin d’installation
propose un raccourci sur le bureau. Le désinstalleur le retire s’il a été créé
par l’installeur.

Le portable crée le marqueur `DooTTY.portable`, sans entrée de registre, raccourci
ou désinstalleur. Son dossier doit rester accessible en écriture. Une erreur
explicite remplace tout repli silencieux vers le profil Windows. Pour déplacer
l’application, fermez-la et déplacez le dossier complet, y compris `data`.

Les licences sont consultables pendant l’installation et livrées avec l’application.
La livraison regroupe les mentions complètes dans `THIRD_PARTY_NOTICES.txt`,
avec `LICENSE` pour DooTTY et un court `THIRD_PARTY.md` renvoyant vers les sources
GitHub. Les textes identiques sont stockés une seule fois ; les attributions
distinctes sont conservées. Les anciens fichiers séparés sont retirés lors des
mises à jour, sans supprimer les fichiers ajoutés par l’utilisateur.
La licence MIT n’impose pas de case d’acceptation. Le runtime Microsoft WebView2
reste un prérequis Windows partagé : s’il manque, l’installation propose sa page
officielle puis s’arrête pour permettre son installation.

## Mise à jour et désinstallation

Relancez le nouvel installeur. Il retrouve l’installation personnelle ou permet de
sélectionner le même dossier portable. Les préférences existantes ne sont jamais
remplacées par les valeurs initiales. Un retour à une version antérieure est refusé.
Les modes utilisent le même format JSON ; leur migration reste manuelle et explicite.

Si DooTTY fonctionne, l’installeur demande sa fermeture normale. Les confirmations
de sessions et les protections des opérations WSL restent actives. Il attend jusqu’à
45 secondes, puis s’arrête si l’application reste ouverte, sans arrêt forcé.
Une seconde ouverture normale remet la fenêtre existante au premier plan, pour le
même emplacement de données. Des dossiers portables distincts restent indépendants.

La désinstallation conserve les réglages par défaut. Une case permet aussi de
supprimer les préférences et le cache de DooTTY. Les distributions, disques et
fichiers Linux ne sont jamais supprimés. Pour le portable, supprimez son dossier
après fermeture ; copiez d’abord `data` si vous souhaitez garder les réglages.

Aucune mise à jour de DooTTY n’est téléchargée automatiquement. Les exécutables
ne sont pas encore signés ; la signature Authenticode reste une étape ultérieure.

## Compilation et publication

GitHub Actions compile l’application et l’installeur sur Windows avec les outils
épinglés du projet. Les branches et demandes de fusion produisent un artefact de
test. Un tag `v<version>` correspondant aux métadonnées crée une **version GitHub
en brouillon** contenant uniquement l’installeur comme fichier joint. Les archives
de sources sont ajoutées automatiquement par GitHub.

La publication reste manuelle après les essais Windows : installation, terminal,
réouverture, portable, mise à jour et désinstallation. Une compilation locale utilise
les mêmes scripts et ne publie rien. Voir le [guide de développement](developpement.md).
