# Créer le connecteur de son tapis, avec l'aide d'une IA

Guide développeur en anglais, avec le contrat et le harnais de conformité : [developers.en.md](developers.en.md).
Le gabarit commence maintenant en lecture seule et exige l'horodatage de la mesure ; Stop est facultatif.

Ton tapis n'est pas un tapis Bluetooth FTMS, mais tu sais comment le lire : une application, Home Assistant, un petit serveur, une passerelle ? Un connecteur fait le lien. Il fait une centaine de lignes, et une IA peut l'écrire avec toi.

## 1. Savoir comment ton tapis se lit

Avant tout, réponds à trois questions :

1. **Où lire la vitesse et la distance ?** Une adresse HTTP qui les donne ? Des entités Home Assistant ? Sinon, un tapis Bluetooth FTMS : le connecteur `ftms` le fait déjà.
2. **L'heure de la mesure** : la source dit-elle quand elle a mesuré ? C'est ce qui permet au kit de savoir si une mesure est périmée.
3. **Comment l'arrêter**, et seulement l'arrêter : une adresse, un service, un bouton ? C'est facultatif : sans arrêt, le jeu le dit et le joueur garde son bouton Stop.

## 2. Partir du modèle

```bash
mkdir mon-tapis
cp modele/connecteur.ts mon-tapis/connecteur.ts
```

Un connecteur a trois fonctions :
- `read` lit le tapis et dit ce qu'il fait ;
- `stop` (facultatif) l'arrête ;
- `open` (facultatif) se prépare.

Pour parler au tapis, il n'utilise que `io.http` et `io.radio`. Ses réglages (adresses, jetons) viennent d'un fichier JSON à côté (`--reglages`), jamais du code.

## 3. Se faire aider par une IA

Donne à ton IA (Claude, ChatGPT ou une autre) le modèle (`modele/connecteur.ts`), le contrat du kit (`src/kit.ts`, les types en tête), la doc de ta source, et cette consigne :

```text
Écris un connecteur de tapis pour le kit de connecteurs de Romeria, à partir du modèle joint.

Mon tapis : <marque, modèle>. Je le lis par : <adresse HTTP / Home Assistant / autre>, voici la doc ou un
exemple de réponse : <coller>. Pour l'arrêter : <adresse ou service>, ou « pas d'arrêt ».

Règles du kit, à respecter strictement :
- Le connecteur lit la vitesse (km/h) et la distance cumulée de la séance (km), et au plus arrête le tapis.
  Il ne le démarre jamais, ne change jamais sa vitesse ni sa pente. Aucune fonction pour le faire.
- Il n'a que name, stopTargets, open, read, stop et close (defineConnector).
- Il ne parle au tapis que par io.http (get pour lire ; post seulement dans stop, vers une adresse listée
  dans stopTargets) et io.radio. Jamais fetch, ni import de node:http, node:net, child_process ou autre.
- read renvoie measuredAtMs = l'heure de la mesure donnée par la source (sinon io.now()), connected faux
  si la source ne répond pas ou dit « indisponible ».
- Les réglages (adresses, jetons) viennent du fichier JSON passé à create(reglages), jamais écrits dans le code.
- Fichier TypeScript, export default function create(reglages), sans dépendance.
```

Relis ce qu'elle propose. Puis essaie : le kit dira ce qui ne va pas.

## 4. Essayer

```bash
node bin/pont.ts --connecteur mon-tapis/connecteur.ts --reglages mon-tapis/reglages.json
```

- Refusé à la relecture ou au chargement : le pont dit pourquoi (un import interdit, un geste en trop). Corrige, ou renvoie le message à ton IA.
- En marche : ouvre `http://127.0.0.1:8800/v1/status` pendant que tu marches. `fresh` doit être vrai, et la vitesse celle de ton tapis.
- Stop : lance `curl -X POST http://127.0.0.1:8800/v1/stop` à petite allure, la main près de la clé de sécurité.

## 5. Le brancher au jeu

Dans Romeria, choisis la source de tapis `pont`, avec l'adresse du pont. Par les réglages, c'est `{ "tapis": { "kind": "pont", "url": "http://127.0.0.1:8800" } }`.

Le pont tourne sur une autre machine (un Raspberry Pi près du tapis) ? Lance-le avec `--hote 0.0.0.0 --jeton-fichier jeton.txt`, et donne le même jeton au jeu.

## 6. Le partager

Le kit est sous licence Apache 2.0. Ton connecteur peut l'être aussi : un dossier sous `exemples/`, avec son `README.md`, un `reglages.exemple.json` sans secret, et un test qui le fait tourner contre une source factice (voir `test/exemples.test.ts`).

## Liste de contrôle

- [ ] `node --test "test/**/*.test.ts"` passe, ton test compris.
- [ ] Aucun secret dans le code ni dans `reglages.exemple.json`.
- [ ] La mesure est périmée quand la source se tait (essaie en coupant le tapis).
- [ ] Stop arrête la bande, ou dit clairement qu'il ne le peut pas.
- [ ] Rien d'autre que lire et arrêter.
