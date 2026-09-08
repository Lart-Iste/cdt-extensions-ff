# Changelog

## 1.2.0 - 2026-09-08

### Fork version Firefox

- **Changement** :
    - Augmentation du temps d'affichage pour le prompt 800>3000
    - Intégration du bouton aux pages Ctd

## 1.1.1 - 2026-02-06

### Corrections

- **Fix du bug de téléchargement MO2** :
    - Autorise les redirections vers `*.confrerie-des-traducteurs.com` (CORS)
    - Résout l'URL finale et récupère le nom de fichier
    - Ajoute le paramètre `filename` au lien `modl://` pour préserver le nom

## 1.1.0 - 2026-02-06

### Corrections

- **Suppression de la permission `tabs`** : Résolution de la violation "Purple Potassium" signalée par l'équipe Google.
  La permission n'était pas nécessaire car l'extension n'accède pas aux propriétés sensibles des onglets.

## 1.0.0 - 2026-02-01

- Version initiale : recherche CdT depuis Nexus + lien MODL vers MO2.
- Boutons repositionnables et paramètres persistés en local.
