# Utiliser DooTTY

<img src="img/Logo_DooTTY_presentation.png" alt="DooTTY — Your native WSL client." width="480"/>

Ce guide regroupe les réglages et les commandes de l’interface. Pour une vue
d’ensemble, consultez la [présentation du projet](../README.md).

## Utilisation

Copiez `DooTTY.exe` dans un dossier Windows puis lancez-le. Aucun outil de
compilation n'est nécessaire pour utiliser l'application. Prérequis : Windows 11
x64, WSL, une distribution Linux et le runtime Microsoft WebView2.

Cette version est livrée sans installateur. Ses préférences sont conservées dans
le profil Windows : elle n'utilise pas encore un fichier de configuration à côté
de l'EXE. Le choix d'un installateur et d'un véritable mode portable est décrit
dans les [options de distribution](distribution.md).

Le binaire n'est pas signé. Un avertissement SmartScreen peut apparaître ; un
lancement depuis un partage UNC peut aussi produire un avertissement d'ouverture.
Utiliser un dossier Windows local permet de distinguer l'effet de l'emplacement.

## Réglages et réouverture

Les préférences sont enregistrées après **Enregistrer**, dans :

```text
%APPDATA%\DooTTY\config.json
```

Au lancement, ce fichier est lu et validé avant la création du premier terminal.
La langue, le profil, l'apparence, le monitoring et les options d'interaction sont
restaurés. L'exemple [config.example.json](../config.example.json) contient les valeurs
initiales. Les anciennes configurations reçoivent les valeurs par défaut des
champs ajoutés. Une configuration invalide reste intacte et une erreur est affichée.

La sauvegarde écrit un fichier temporaire synchronisé avant de remplacer l'ancien.
Une erreur de sauvegarde ne doit pas détruire les préférences précédentes.
Les onglets ouverts, leur sortie, la pause du monitoring et son historique ne sont
pas enregistrés. Le profil WebView2 est géré séparément dans le dossier local de
l'application Windows ; les préférences DooTTY ne dépendent pas du cache de la WebView.

## Monitoring

Activé par défaut, il se désactive dans **Général → Activer le monitoring WSL**.
Le choix est enregistré. Le rail compact fait 56 px et se déplie par le bouton à
trois barres. Les pourcentages passent en orange à 75 % et en rouge à 90 %.

Une sonde Linux fixe est pilotée par Rust, sans installer d'agent ni demander
l'élévation. Une seule collecte est active ; la prochaine démarre deux secondes
après la précédente. Les lectures sont suspendues dans les paramètres, quand le
document est masqué, en pause ou sans session connectée. Une lecture déjà en cours
peut encore se terminer. L'historique reste en mémoire, borné à cinq minutes par profil.

Sous WSL2, **CPU, mémoire et réseau sont partagés entre distributions**. Les volumes
et E/S du disque racine correspondent à l'espace de montage de la distribution.
Le monitoring n'attribue pas ces ressources à ses seuls processus et ne surveille
pas les machines SSH distantes. L'utilisateur affiché est celui du profil de lancement.

Le bouton de dossier ouvre le répertoire de lancement du profil, résolu dans Linux,
via l'Explorateur Windows. Il ne suit pas les changements de répertoire faits ensuite
à l'intérieur du shell.

## Gestion WSL

Les commandes passent directement par le `wsl.exe` système, avec arguments séparés,
sans PowerShell ni CMD. Les actions modificatrices demandent confirmation et une
seule opération de gestion peut s'exécuter à la fois.

Le premier accès aux paramètres vérifie la version installée, la configuration
actuelle et la dernière publication stable Microsoft WSL sur GitHub. Les résultats
restent en mémoire jusqu'à la fermeture de DooTTY. L'icône de synchronisation
force une nouvelle lecture ; l'icône GitHub ouvre les notes du tag stable.
Il n'y a aucune recherche de version au lancement de l'application.

La mise à jour n'est proposée qu'après comparaison avec une version stable plus
récente. Elle lance `wsl.exe --update --web-download` après confirmation. En cas
d'échec, une reprise administrateur explicite peut déclencher l'UAC pour cette
seule commande fixe ; DooTTY et ses terminaux gardent leurs droits habituels.

**Arrêter WSL** lance `wsl.exe --shutdown`, sans relance demandée par DooTTY.
**Redémarrer** sur une distribution réalise un arrêt ciblé puis relance ses
terminaux DooTTY. L'arrêt global peut interrompre les autres applications utilisant WSL.
Les sondes sont coordonnées avec les arrêts internes et vérifient l'état courant
avant de démarrer. Un arrêt lancé à l'extérieur n'utilise pas ce verrou ; les
courses entre applications et les relances par d'autres clients restent à tester
sur le poste. Fermer un onglet ferme sa session, sans arrêt global de WSL.

Les exports refusent les fichiers existants. Les imports exigent un nouveau nom
et un nouveau dossier. Aucun effacement de distribution n'est exposé. Les chemins
d'import/export sont des chemins Windows absolus sur un disque local.

## Raccourcis

| Action | Raccourci |
|---|---|
| Nouvel onglet / fermer l'onglet | Ctrl+Maj+T / Ctrl+Maj+W |
| Onglet suivant / précédent | Ctrl+Tab / Ctrl+Maj+Tab |
| Paramètres | Ctrl+, |
| Copier / coller | Ctrl+Maj+C / Ctrl+Maj+V |
| Coller | Maj+Inser |
| Tout sélectionner | Ctrl+Maj+A |
| Rechercher | Ctrl+Maj+F |
| Zoom / réduire / réinitialiser | Ctrl+Plus / Ctrl+Moins / Ctrl+0 |

Ctrl+C, Ctrl+D, Ctrl+Z et AltGr restent transmis au terminal. Dans les applications
qui demandent la souris, Maj permet de forcer la sélection locale ou le collage au clic droit.
