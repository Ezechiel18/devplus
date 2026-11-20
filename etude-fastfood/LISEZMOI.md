# Carte et tableau de bord : implantation d'un fast-food

Page web interactive qui présente les résultats du pipeline FME : 39 943 zones de 500 m en Pays de la Loire et en Bretagne, classées selon leur potentiel pour un restaurant rapide (NAF 56.10C).

## Contenu du dossier

| Fichier | Rôle |
| --- | --- |
| `index.html` | La page |
| `css/style.css` | La mise en forme |
| `js/app.js` | La carte (MapLibre), les deux modes, la fiche, les alternatives et les téléchargements |
| `data/zones.js` | Les données de la carte, lues par la page (permet le double-clic) |
| `data/zones.geojson` | Les mêmes données en GeoJSON (WGS84), pour QGIS |
| `scripts/preparer_donnees.py` | Le script qui produit `zones.geojson` |
| `archives/` | Les versions précédentes de la page, gardées telles quelles (à ne pas mettre en ligne) |

## Ce que fait la page

- Deux modes : « Analyse de référence » (poids 35, 30, 20 et 15 %) et « Simulation » (curseurs de 0 à 100, score et rang recalculés dans le navigateur).
- Filtres : département, profil de zone recherché, classes affichées.
- Recherche : nom de commune (liste des communes étudiées), ou adresse via le géocodage de la Géoplateforme.
- Fiche de zone toujours visible, avec aperçu imprimable en PDF.
- Recherche d'alternatives à moins de 5 km.
- Téléchargement de la sélection, ou de toutes les zones, en Excel (avec une feuille « Notice ») et en GeoJSON.
- Guide d'utilisation : le texte en 10 rubriques du document de méthode.
- Fond de carte Plan IGN (Géoplateforme, sans clé).

## Données préparées

- Colonnes gardées : rang, score, les 4 critères normalisés, distance à la route principale, niveau de vie, densité, population, nombre de fast-foods à moins de 2 km, commune, code INSEE, département, centre du carreau en Lambert-93. Les colonnes techniques FME sont retirées.
- Commune : celle qui contient un point intérieur du carreau. Pour 115 carreaux en bord de côte, aucun point ne tombe dans une commune : la commune la plus proche est utilisée.
- Niveau de vie : 3 989 carreaux n'ont pas de valeur Filosofi (secret statistique). FME leur a donné la médiane de l'étude (24 409 €) ; la page l'indique dans la fiche.
- Classes : les rangs limites sont lus dans `grille_score.gpkg` (399, 1 997, 7 989 et 19 972). La simulation garde ces mêmes effectifs par classe.

Pour régénérer les données après une nouvelle sortie FME :

```
pip install geopandas pyogrio
python scripts/preparer_donnees.py ../data data/zones.geojson
```

## Tester sur l'ordinateur

Double-cliquer sur `index.html` suffit. Il faut une connexion internet pour le fond de carte, la bibliothèque de carte et les polices.

## Mettre en ligne sur GitHub Pages

1. Créer un dépôt public sur GitHub, par exemple `carte-fastfood`.
2. Y déposer **le contenu de ce dossier seulement** (pas tout le dossier du projet), sans le dossier `archives`.
3. Dans le dépôt : Settings, Pages, Source « Deploy from a branch », branche `main`, dossier `/ (root)`.
4. La page est en ligne au bout d'une à deux minutes à l'adresse `https://<votre-compte>.github.io/carte-fastfood/`.

Le fichier `zones.js` pèse environ 15 Mo, et environ 4 Mo une fois compressé par GitHub Pages au téléchargement.

## Bibliothèques et services externes

- MapLibre GL JS 4.7.1 (unpkg)
- SheetJS 0.20.3 pour l'export Excel (chargé seulement au clic ; si le chargement échoue, un CSV est téléchargé à la place)
- Polices Source Serif 4 et Source Sans 3 (Google Fonts)
- Géoplateforme IGN : fond Plan IGN et géocodage
