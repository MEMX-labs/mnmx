# MNMX SDK

Client libraries for the MNMX routing engine.

## TypeScript

```bash
npm install @mnmx/core
```

```typescript
import { MnmxRouter } from '@mnmx/core';

const router = new MnmxRouter({ strategy: 'minimax' });
const route = await router.findRoute({
  from: { chain: 'ethereum', token: 'USDC', amount: '100000' },
  to:   { chain: 'solana',   token: 'USDC' },
});
// { expectedOutput: 99200, guaranteedMinimum: 98800, totalFees: 4.2 }
```

## Python

```bash
pip install mnmx
```

```python
from mnmx import MnmxRouter

router = MnmxRouter(strategy="minimax")
route = router.find_route(
    from_chain="ethereum", from_token="USDC",
    amount="100000", to_chain="solana", to_token="USDC",
)
# RouteResult(expected=99200, guaranteed=98800, fees=4.2, time=45)
```

## API Reference

Full documentation: [mnmx.app/docs](https://mnmx.app/docs)
