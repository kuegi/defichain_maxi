Encrypt your seed:

docker-compose run --build vault-maxi create_seed_string


Configure container:

Change the settings in the file docker-compose.yml to your needs.
The container is able to handle MAX_SETTINGS count of setting blocks.


Build and Run container in detached mode:

docker-compose up --build -d


Build and Run container in attached mode:

docker-compose run --build vault-maxi


View logs:

docker logs [-f (follow)] <container name or id>
