# Simple STT Lab

Prototype indépendant et minimal pour répondre à trois questions uniquement :

1. L'audio capturé est-il bon ?
2. La transcription LIVE est-elle bonne ?
3. La retranscription manuelle de l'audio enregistré est-elle bonne ?

Aucun retry automatique, aucune concurrence, aucune queue, aucun provider abstrait, aucun service worker, aucune réintégration V41.x.

## Protocole humain

- Enregistrer 15 à 30 secondes, arrêter, réécouter.
- Lancer LIVE, parler 15 à 20 secondes, arrêter.
- Cliquer une fois sur `Transcrire l’enregistrement`.
- Répéter exactement le même test sur Edge et Chrome.

La zone `Détails` conserve uniquement les événements et erreurs utiles au diagnostic.
