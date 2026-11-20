"""Prépare la couche web à partir de la sortie FME.

Entrées : data/grille_score.gpkg (sortie FME) et data/france_metro_com.gpkg (communes IGN).
Sortie : site-web/data/zones.geojson (WGS84, colonnes utiles seulement).
Usage : python preparer_donnees.py <dossier data> <fichier de sortie>
"""
import json, sys
import geopandas as gpd
import numpy as np
from shapely import force_2d

src, out = sys.argv[1], sys.argv[2]
g = gpd.read_file(f"{src}/grille_score.gpkg")
com = gpd.read_file(f"{src}/france_metro_com.gpkg")[["code", "nom", "departement", "geometry"]]
DEPTS = ["22", "29", "35", "56", "44", "49", "53", "72", "85"]
com = com[com.departement.astype(str).isin(DEPTS)]

g["geometry"] = force_2d(g.geometry)
pts = g.copy()
pts["geometry"] = g.geometry.representative_point()
j = gpd.sjoin(pts, com, how="left", predicate="within")
j = j[~j.index.duplicated()]
# repli : commune la plus proche pour les points hors communes (bord de côte)
miss = j.code.isna()
if miss.any():
    near = gpd.sjoin_nearest(pts[miss], com, how="left")
    near = near[~near.index.duplicated()]
    for c in ["code", "nom", "departement"]:
        j.loc[miss, c] = near[c]
print("carreaux sans commune après repli :", int(j.code.isna().sum()), "; repli plus proche :", int(miss.sum()))

cen = g.geometry.centroid
w = g.to_crs(4326)
feats = []
for i in range(len(g)):
    r = g.iloc[i]
    geom = w.geometry.iloc[i]
    if geom.geom_type == "MultiPolygon" and len(geom.geoms) == 1:
        geom = geom.geoms[0]
    gj = json.loads(json.dumps(geom.__geo_interface__), parse_float=lambda s: round(float(s), 5))
    nv = r.niv_vie_moy
    feats.append({
        "type": "Feature",
        "id": i,
        "geometry": gj,
        "properties": {
            "r": int(r.rang),
            "s": round(float(r.score), 5),
            "a": round(float(r.acc_norm), 5),
            "p": round(float(r.pa_norm), 5),
            "d": round(float(r.dens_norm), 5),
            "h": round(float(r.huff_norm), 5),
            "dr": int(round(r.dist_route)),
            "nv": None if np.isnan(nv) else int(round(nv)),
            "de": int(round(r.densite)),
            "nc": int(r.nb_conc_2km),
            "po": round(float(r["pop"]), 1),
            "c": str(j.nom.iloc[i]),
            "ic": str(j.code.iloc[i]),
            "dp": str(j.departement.iloc[i]),
            "x": int(round(cen.iloc[i].x)),
            "y": int(round(cen.iloc[i].y)),
        },
    })

ORDRE = ["Peu favorable", "Moyen", "Favorable", "Très favorable", "Prioritaire"]
bornes = g.groupby("classe_rang").rang.max()
# rang maximal de chaque classe, de Prioritaire à Moyen (le reste est Peu favorable)
seuils = [int(bornes[c]) for c in ORDRE[:0:-1]]
meta = {"n": len(g), "seuilsRang": seuils, "medianeNiveauVie": round(float(g["niv_vie_moy.median"].iloc[0])),
        "bbox": [round(v, 4) for v in w.total_bounds.tolist()]}
with open(out, "w", encoding="utf-8") as f:
    json.dump({"type": "FeatureCollection", "meta": meta, "features": feats}, f, ensure_ascii=False, separators=(",", ":"))
# Copie en script JavaScript : permet d'ouvrir index.html par double-clic, sans serveur
out_js = out[:-len(".geojson")] + ".js" if out.endswith(".geojson") else out + ".js"
with open(out, encoding="utf-8") as f:
    contenu = f.read()
with open(out_js, "w", encoding="utf-8") as f:
    f.write("window.ZONES_DATA = " + contenu + ";\n")
print("écrit", out, "et", out_js, len(feats))
