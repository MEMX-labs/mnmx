.PHONY: build test lint clean bench docs

build:
	npm run build
	cd engine && cargo build --release

test:
	npm test
	cd engine && cargo test
	cd sdk/python && python -m pytest

lint:
	npm run lint
	cd engine && cargo clippy

clean:
	rm -rf dist/
	cd engine && cargo clean

bench:
	cd engine && cargo bench
