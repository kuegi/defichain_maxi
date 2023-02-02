Trigger Intervall einstellen:

Im docker-compose.yml den Wert für TRIGGER_MINS anpassen

Container bauen lassen und starten:

   docker-compose up --build [-d]

Settings und seed vorbereiten:

Nach dem Start sind auf dem dDockerhost unter /opt/vault-maxi/ 2 dateien zu befüllen:

seed.txt          <- 24 Wörter seed phrase mit Komma getrennt: Wort1,Wort2,...,WortX in der ersten Zeile der Datei.
settings.json

Logs:

   docker logs -f docker-vault-maxi-1

bash im container:

   docker exec -it docker-vault-maxi-1 bash

Container stoppen:

   docker container stop docker-vault-maxi-1
