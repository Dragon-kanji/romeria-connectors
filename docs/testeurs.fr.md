# Brancher son tapis à Romeria

Préparez le jeu hors de la bande, tapis arrêté. Gardez la télécommande, Stop et la clé de sécurité accessibles. Le jeu ne démarre ni n'accélère le tapis. Fermer le jeu n'arrête pas la bande. Aucun achat ni exercice supplémentaire n'est demandé.

## 1. Lancer le diagnostic local

Fermez l'application du fabricant si elle tient déjà la connexion, puis activez le Bluetooth de Windows. Dans le dossier du serveur livré avec le jeu, double-cliquez sur **romeria-diagnostic.cmd**. Choisissez le numéro de votre appareil et indiquez sa marque et son modèle, sans numéro de série. Le scan dure 5 secondes, la lecture des services et notifications au plus 25 secondes. Aucune commande, demande d'appairage, initialisation propriétaire ou prise de contrôle n'est envoyée. Seul le descripteur Bluetooth d'abonnement aux notifications (CCCD) est écrit.

Un résultat vide est utile : radio désactivée, capteur endormi, autre application connectée ou absence de BLE lisible sont possibles. Pour identifier un nom inconnu, comparez éventuellement une recherche tapis éteint puis allumé, bande arrêtée, selon sa notice. Ne débranchez jamais un tapis en mouvement. Audio Bluetooth et télécommande sans fil ne prouvent pas une interface de données fitness.

```powershell
.\romeria-diagnostic.cmd --langue fr --modele "LONTEK 3.0 HP" --rapport rapport-lontek.txt
```

Le rapport reste sur le PC, sans écraser un ancien fichier. `--adresse AA:BB:CC:DD:EE:FF` sélectionne directement l'adresse montrée dans le menu local. Le rapport partageable masque les adresses. `--simuler` vérifie l'outil sans radio et marque le rapport SIMULATION. Depuis les sources : `node bin/diagnostic.ts --pilote chemin/ashiato-ftms.exe`.

## 2. Selon le résultat

| Résultat | Suite |
| --- | --- |
| FTMS et vitesse lisible | Choisissez FTMS dans le jeu, ou lancez le pont FTMS ci-dessous. Zéro est une vraie lecture à l'arrêt. |
| RSC et vitesse lisible | Lancez le pont RSC. L'allure vient du capteur de foulée, pas du moteur. Suivez la notice du capteur pour son étalonnage. |
| Signature propriétaire FitShow, KingSmith ou autre | Envoyez le rapport. Un UUID partagé n'identifie pas sûrement une marque. Le statut KingSmith classique peut être décodé s'il arrive seul. Les variantes et unités FitShow demandent confirmation, donc leurs trames ne deviennent pas des vitesses inventées. |
| Rien de lisible | Vitesse déclarée, capteur BLE RSC déjà disponible, ou Balade sans progression réelle. N'achetez rien pour le test. ANT+ seul ne suffit pas. |

## 3. Brancher le pont au jeu installé

Gardez sa console ouverte. Lancez Romeria et arrêtez physiquement la bande avant de changer de source. Depuis le dossier du serveur, dans PowerShell :

```powershell
.\romeria-pont.cmd --connecteur rsc --adresse AA:BB:CC:DD:EE:FF --pilote .\ftms\ashiato-ftms.exe
# ou, pour un tapis FTMS
.\romeria-pont.cmd --connecteur ftms --adresse AA:BB:CC:DD:EE:FF --pilote .\ftms\ashiato-ftms.exe
```

Dans une deuxième console, lancez `.\romeria-brancher.cmd`. Il sélectionne le pont `http://127.0.0.1:8800` par l'API locale protégée du jeu, sans afficher son jeton ni changer le coach. Profil par défaut : `%LOCALAPPDATA%\Romeria`. Pour un autre profil, `--profil "chemin-du-profil"` ; une ancienne installation de développement utilise parfois `%LOCALAPPDATA%\Ashiato`. HTTP 409 : arrêtez d'abord la bande. Cet outil refuse les adresses distantes et ne contacte aucun Pi.

Le bouton de diagnostic dans l'interface native du jeu reste à raccorder. Les lanceurs du paquet sont disponibles dès que l'organisateur livre ce kit. Si votre version ne les contient pas, demandez le paquet actualisé ou utilisez les sources avec Node 24 : `node bin/pont.ts ...`, `node bin/brancher.ts ...`.

## 4. Tapis sans données : vitesse déclarée

Lancez `.\romeria-pont.cmd --connecteur declare --langue fr`, puis branchez ce pont comme ci-dessus. Vous démarrez et réglez le tapis avec sa télécommande physique. Quand vous pouvez le faire sans gêner votre marche, saisissez sa vitesse affichée en **km/h** dans la console, puis Entrée, par exemple `3,0`. `pause` suspend l'estimation, `0` déclare l'arrêt. Ne saisissez rien en marchant si cela vous distrait.

Plage déclarable : 0 à 10 km/h, ce n'est ni un conseil d'allure ni une qualification de commande. Au lancement, aucune vitesse n'est active. Confirmez au moins toutes les 15 minutes. Un trou de lecture de plus de 3 secondes désarme le mode ; après reconnexion ou redémarrage, il faut déclarer de nouveau. Si la vitesse physique change, mettez-la à jour quand c'est possible ou suspendez l'estimation.

Stop dans le jeu suspend l'estimation et rappelle d'arrêter physiquement le tapis. RSC ne sait pas l'arrêter non plus. Le Carnet porte « Vitesse déclarée par le joueur » dans les notes du Bilan, même pour une séance mixte ; sa distance est estimée. RSC porte sa propre note. Les plafonds du plan restent les mêmes, sans gain pour le volume en plus. Balade et les simulations du kit ne créditent rien.

## 5. Le retour à envoyer

Copiez le bloc depuis `Romeria diagnostic v1`, relisez-le puis envoyez-le par le canal privé convenu avec l'organisateur. Ajoutez version du jeu, version de Windows, modèle exact et présence éventuelle d'une autre application connectée. Aucun réglage complet, jeton, numéro de série, plan ou capture Bluetooth brute. Aucun envoi automatique.

Pour le LONTEK : référence exacte de l'étiquette, notice, éventuel nom d'application ou destination du QR, mention Bluetooth et boutons de la télécommande. La puissance 3,0 HP et la limite 10 km/h ne prouvent aucune connectivité.
