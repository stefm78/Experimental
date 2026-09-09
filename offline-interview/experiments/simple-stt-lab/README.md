# Simple STT Lab

Prototype indépendant et minimal pour répondre à trois questions uniquement :

1. L'audio capturé est-il bon ?
2. La transcription LIVE est-elle bonne ?
3. Quelle retranscription manuelle de l'audio enregistré est réellement exploitable ?

Deux voies sont visibles pour le point 3 :

- `Navigateur` : Web Speech `SpeechRecognition.start(audioTrack)` — conservé uniquement comme contrôle expérimental ;
- `Whisper local` : Transformers.js + `onnx-community/whisper-base`, exécuté dans le navigateur. Le modèle est téléchargé/caché au premier usage ; l'audio n'est pas envoyé à un service de transcription.

Aucun retry automatique, aucune concurrence, aucune queue, aucun backend, aucun provider abstrait, aucun service worker, aucune réintégration V41.x.

## Décision terrain V2

Edge 152 a consommé la totalité d'un enregistrement de 15,06 s via `HTMLMediaElement.captureStream()`, avec piste live et fin de reconnaissance postérieure à la fin média, mais a retourné un texte vide. Cette voie navigateur n'est donc plus poursuivie comme moteur saved-audio Edge.

## Protocole humain V3

- Enregistrer 10 à 15 secondes, arrêter, réécouter.
- Lancer LIVE sur une phrase comparable.
- Cliquer une fois sur `Navigateur` pour conserver le témoin.
- Cliquer une fois sur `Whisper local`. Le premier lancement peut être sensiblement plus long à cause du téléchargement du modèle.
- Répéter sur Edge puis Chrome.

La zone `Détails` conserve uniquement les événements et erreurs utiles : moteur, device, temps de chargement, temps de transcription et texte obtenu.
