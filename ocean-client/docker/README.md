Encrypt your seed:

docker-compose run --build vault-maxi create_seed_string


Build and Run container in detached mode:

docker-compose up --build -d


Build and Run container in attached mode:

docker-compose run --build vault-maxi


View logs:

docker logs [-f (follow)] <container name or id>
