# Benchmarks

Route scoring performance benchmarks.

## Run

```bash
cd engine
cargo bench
```

## Results (M1 Pro)

| Benchmark | Time |
|-----------|------|
| Score 10 candidates | 0.8ms |
| Score 100 candidates | 4.2ms |
| Score 1000 candidates | 38ms |
| Full search (3000 paths) | 8.1ms |
