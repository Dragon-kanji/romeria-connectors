# Exemple : KingSmith (WalkingPad) par Home Assistant

Pour un tapis KingSmith déjà relié à Home Assistant par son intégration. Le connecteur lit les entités du tapis par l'API REST de Home Assistant. Pour Stop, il appelle le seul service d'arrêt déclaré : le kit refuserait toute autre écriture.

1. Dans Home Assistant, crée un jeton d'accès longue durée (Profil, Sécurité).
2. Dans Outils de développement, États, relève les entités du tapis :
   - la vitesse en km/h (`sensor.…_speed`) ;
   - la distance en km (`sensor.…_distance`) ;
   - au choix, un capteur qui dit si la bande tourne ;
   - le service qui l'arrête.
3. Copie `reglages.exemple.json` en `mes-reglages.json`, et remplis-le. Garde ce fichier pour toi : il contient le jeton.
4. Lance le pont :

   ```bash
   node bin/pont.ts --connecteur exemples/kingsmith-home-assistant/connecteur.ts --reglages mes-reglages.json
   ```

5. Dans Romeria, choisis la source de tapis `pont`, adresse `http://127.0.0.1:8800`.

## Fraîcheur

La mesure date du dernier rapport de Home Assistant sur la vitesse (`last_reported`, sinon `last_updated`). Si l'intégration ne rapporte pas au moins toutes les 3 s, la mesure sera dite périmée et le jeu ne comptera rien : il faut alors régler la cadence de l'intégration.

## Le cas du joueur au Raspberry Pi

Chez le créateur de Romeria, le tapis passe par son propre Raspberry Pi (`ksfit-control`), avec ses gardes à lui. Cet exemple ne le remplace pas : sur ce montage, le jeu garde la source `ashiato-pi`.
