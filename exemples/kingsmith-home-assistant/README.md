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

## Services locaux sur Raspberry Pi

Un service local sur un Raspberry Pi peut être relié au pont avec [le connecteur HTTP local](../../docs/http-local.md). L'exemple Home Assistant s'utilise quand le tapis expose ses mesures et son arrêt via l’API de Home Assistant.
