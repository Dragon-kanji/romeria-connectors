# Signatures Bluetooth et limites du diagnostic

Sources primaires consultées le 1 novembre 2026. Les identifiants ci-dessous servent à une détection prudente, pas à certifier une marque. Aucune bibliothèque tierce ni séquence de commande n'est copiée dans le kit.

| Famille | Service, données | Traitement |
| --- | --- | --- |
| FTMS | `1826`, `2ACD` | Décode les champs présents de Treadmill Data. Aucun abonnement au point de contrôle en diagnostic. |
| RSC | `1814`, `2A53` | Vitesse uint16 en 1/256 m/s, cadence, longueur de foulée optionnelle en cm, distance optionnelle uint32 en 0,1 m. Aucun accès à `2A55`. |
| KingSmith classique | `FE00`, `FE02` | Indice possible seulement. Décode un statut spontané classique de 20 octets, enveloppe et somme vérifiées. Ne sollicite aucun statut, aucun appairage propriétaire. |
| FitShow et apparentés | `FFF0/FFF1`, `FFE0/FFE1`, `AE00/AE01` | Services partagés avec d'autres matériels. Lit ou s'abonne aux données si disponibles. Note les trames reçues sans attribuer d'unités incertaines. Aucune initialisation ni interrogation propriétaire. |
| Nordic UART | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | Transport générique reconnu, pas une preuve de tapis ni une promesse de décodage. |

Références : [Bluetooth SIG, Running Speed and Cadence Service](https://www.bluetooth.com/specifications/specs/running-speed-and-cadence-service-1-0/), [GATT Specification Supplement, RSC Measurement](https://btprodspecificationrefs.blob.core.windows.net/gatt-specification-supplement/GATT_Specification_Supplement.pdf), [Bluetooth SIG, Assigned Numbers](https://www.bluetooth.com/specifications/assigned-numbers/), [KingSmith, observations de ph4-walkingpad](https://github.com/ph4r05/ph4-walkingpad/blob/master/ph4_walkingpad/pad.py), [FitShow, services et variantes dans QZ](https://github.com/cagnulein/qdomyos-zwift/blob/master/src/devices/fitshowtreadmill/fitshowtreadmill.cpp), [Nordic UART Service](https://docs.nordicsemi.com/bundle/ncs-latest/page/nrf/libraries/bluetooth/services/nus.html).

Les UUID et formats observés ne sont pas le code des projets cités. Les implémentations du kit sont locales et minimales. Toute reprise future de code tiers demande une revue de sa licence ; une référence ne donne pas une permission de relicencier ce code.

La fiche [LONTEK B0FX28W23H](https://www.amazon.fr/dp/B0FX28W23H) n'a pas pu être relue automatiquement pendant ce chantier. « 3.0 HP, 10 km/h, inclinable, télécommande » est l'identification fournie par le joueur, pas une preuve de Bluetooth. Demander la référence de l'étiquette, la notice et le rapport avant d'affirmer une compatibilité. Une télécommande peut utiliser une autre radio ou de l'infrarouge. Aucun démontage n'est nécessaire pour ce premier test.
