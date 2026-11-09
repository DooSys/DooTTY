# Changements

## Non publié

- Bouton Enregistrer actif uniquement lorsque les paramètres ont réellement changé, indépendamment de l’ordre des propriétés renvoyées par Rust.

- Profils de lancement enregistrés et choix du profil d’ouverture.
- Menu contextuel des onglets : renommage, duplication et fermeture des autres terminaux.
- Palette de commandes accessible avec Ctrl+Maj+P.
- Effacement de l’écran/historique et export du buffer actif en texte UTF-8.
- Confirmation facultative du collage multiligne avec aperçu.
- Lecture seule par onglet, sans interrompre la réception des sorties.
- Tests de l’interface de production ajoutés aux workflows Windows et de release.

## 0.0.7

- Lecture UTF-8 explicite des sources NSIS pour préserver les accents de l’installeur Windows.
- Fenêtre agrandie limitée à la zone de travail de l’écran, au-dessus de la barre des tâches.
- Détection des liens HTTP(S) du terminal et ouverture par Ctrl+clic dans le navigateur par défaut, y compris les liens OSC 8.
- Métadonnées Windows de l’application et de l’installeur harmonisées avec l’éditeur DooSys.
- Attestation de provenance des installeurs publiés via GitHub Actions ; elle ne constitue pas une signature Authenticode.
- Configuration CodeRabbit adaptée au projet et raccourci des liens ajouté au guide d’utilisation.

## 0.0.6

- Titre de distribution conservé pendant le titre Windows provisoire, sans attente ajoutée.
- Notices tierces dédupliquées et regroupées dans une livraison de trois fichiers légaux.

- Un seul installeur Windows avec installation par utilisateur ou extraction portable.
- Préférences et cache isolés dans `data` en mode portable.
- Mise à jour par relance de l’installeur, fermeture normale et conservation des réglages.
- Désinstallation Windows, avec suppression facultative des préférences et du cache.
- Réouverture de la fenêtre existante et raccourci bureau facultatif en fin d’installation.
- Thèmes sombre et clair, bouton lune/soleil et préférence persistante.
- Logo officiel WSL au niveau du lien WSL Settings.
- Génération Windows et préparation des versions GitHub en brouillon depuis les tags.
- Badge Bêta réservé à la section Installation et sauvegarde WSL.
- Catalogue WSL synchronisé et sélection guidée des distributions disponibles.
- Relance globale de WSL et reconnexion des terminaux ouverts.
- Thème de l’interface indépendant des palettes du terminal.

## 0.0.5 — Bêta

- Terminal Windows natif pour les distributions WSL existantes, onglets et profils de lancement.
- Interface français/anglais, réglages persistants et cinq palettes.
- Copie/collage, sélection rectangulaire, recherche et confirmations de fermeture.
- Monitoring repliable lié à l'onglet actif, graphes, couleurs de charge et dossier du profil.
- Gestion WSL, synchronisation des versions et accès aux notes de la dernière stable.
- Installation et sauvegarde marquées Bêta.
- Préparation du code public : exemples anonymisés, documentation courante,
  licence MIT, notices tierces et contrôles de publication/réouverture.
