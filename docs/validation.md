# Validation de DooTTY

## Contrôles reproductibles

```sh
npm ci
npm run check:public
npm run check:translations
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo fmt --check --manifest-path src-tauri/Cargo.toml
```

Les deux options TypeScript `noUnusedLocals` et `noUnusedParameters` font partie
de la compilation. Le contrôle public examine les fichiers suivis et les fichiers
non ignorés : les fichiers personnels accidentellement suivis ne sont pas masqués.
Sans dépôt Git exploitable, il utilise un index temporaire isolé pour examiner le
répertoire de travail. Il ne contrôle alors aucun historique Git et ne crée pas
de dépôt dans le projet.

Ce contrôle détecte des chemins privés, des formats de secrets connus, des fichiers
générés inattendus et les liens Markdown locaux cassés. Il complète une relecture ;
il ne constitue pas une preuve de l'absence de tout secret possible. Les mentions
légales des auteurs tiers sont conservées telles quelles.

Le test Rust `settings_reopen` écrit réellement les préférences dans un dossier
temporaire, puis les recharge dans deux nouveaux processus. Il compare tous les
champs, vérifie que la réouverture ne réécrit pas le fichier et qu'aucun fichier
temporaire de configuration ne subsiste. Les tests couvrent aussi la migration
d'anciennes configurations et la préservation d'un fichier lors d'une sauvegarde invalide.

Les tests PTY Linux vérifient entrée/sortie, redimensionnement, arrêt et isolation
des sessions. La sonde Linux fixe est exécutée en lecture seule. Les tests de
contrôle vérifient qu'une distribution absente ou une session en fermeture ne
reçoit pas de nouvelle sonde. Ils ne remplacent pas les essais ConPTY sous Windows.

## Essais Windows avant publication

| Parcours | Vérification |
|---|---|
| Premier lancement | Distribution par défaut, shell interactif, WebView2 |
| Réouverture | Modifier plusieurs réglages, Enregistrer, fermer complètement, relancer |
| Annulation | Modifier sans enregistrer, annuler et vérifier les valeurs conservées |
| Onglets | Deux distributions, profil conservé à la reconnexion, fermeture indépendante |
| Terminal | Copier/coller, caractères Unicode/AltGr, recherche, zoom, sélection rectangulaire |
| Fenêtre | Agrandir avec la souris puis saisir Entrée ; redimensionner ; navigation clavier |
| Monitoring | Comparer avec les outils Linux, changer d'onglet, pause/reprise, désactivation persistante |
| Dossier du profil | Domicile habituel, utilisateur root et répertoire personnalisé avec espaces |
| Versions | Premier accès aux paramètres, cache pendant la session, synchronisation forcée |
| Arrêt | Arrêt interne, puis arrêt externe ; vérifier les éventuelles relances par d'autres clients |
| Gestion Bêta | Catalogue ; import/export/installation uniquement sur des données de test choisies |
| UAC | Confirmation, annulation et résultat de la reprise administrateur d'une mise à jour |

Les tests navigateur de développement simulent les appels natifs ; leur mémoire
JS/ArrayBuffer ne représente pas la mémoire du processus WebView2 sur Windows.
Une compilation ou une inspection PE ne prouve pas le fonctionnement Windows réel.

## Vérification de publication

`npm run check:public` doit réussir sur l'index qui sera publié. Examiner aussi
les changements et l'historique si le dépôt existe déjà. `.local`, les préférences,
les secrets et les sorties de compilation restent ignorés. Les archives binaires
doivent inclure `LICENSE`, `THIRD_PARTY.md`, `THIRD_PARTY_NOTICES.txt` et `licenses/`.
La version des métadonnées npm, Cargo, Tauri et de l'exécutable doit être cohérente.
