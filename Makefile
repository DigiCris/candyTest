.PHONY: up reset down logs status test
up:
	./candy.sh up
reset:
	./candy.sh reset
down:
	./candy.sh down
logs:
	./candy.sh logs
status:
	./candy.sh status
test:
	npm run check
