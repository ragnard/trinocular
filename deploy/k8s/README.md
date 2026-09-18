# Trinette on Kubernetes

A [kustomize](https://kustomize.io/) layout to start from — plain manifests, no
templating. Everything a deployment needs to decide is in one overlay
directory; everything it does not is in `base/`.

```
base/                  Deployment + Service. Not deployable on its own.
components/ingress/    An Ingress, opted into by an overlay.
overlays/example/      Copy this: config.yaml, secrets.env, the host.
```

## Deploying

```bash
cp -r deploy/k8s/overlays/example deploy/k8s/overlays/mine
$EDITOR deploy/k8s/overlays/mine/config.yaml       # the config file, as in the README
$EDITOR deploy/k8s/overlays/mine/secrets.env       # what its ${...} refer to
$EDITOR deploy/k8s/overlays/mine/kustomization.yaml  # the host, image tag, namespace
kubectl apply -k deploy/k8s/overlays/mine
```

The overlay generates three objects the base's Deployment names:

| Object | From | Reaches the container as |
| --- | --- | --- |
| ConfigMap `trinette-config` | `config.yaml` | `/etc/trinette/config.yaml`, which `TRINETTE_CONFIG` names |
| ConfigMap `trinette-env` | `literals` in `kustomization.yaml` | environment: `ORIGIN` |
| Secret `trinette-secrets` | `secrets.env` | environment: what `${...}` in `config.yaml` resolves to |

So `config.yaml` is an ordinary Trinette config file with the secrets taken
out and `${COOKIE_SECRET}`-style references left in their place, and can be
committed. Kustomize suffixes each generated name with a hash of its contents
and rewrites the Deployment to match, so editing any of the three and applying
again rolls the pods — there is no restart to remember.

`secrets.env` holds real secrets and must not be committed as such. The
placeholders in the example are deliberately too short for the server to
accept, so an overlay deployed unedited refuses to start rather than running
behind a session key printed in this repository. The usual arrangements — SOPS,
sealed-secrets, an external-secrets operator — all produce a Secret; point the
Deployment at it with a patch in place of the `secretGenerator`, keeping the
keys `config.yaml` refers to.

## The host

`ORIGIN` and the Ingress host are the same address, and both are set in the
overlay's `kustomization.yaml`, next to each other. `ORIGIN` is not optional:
the session cookie's `Secure` flag and the OIDC redirect are both derived from
it. The Ingress is a component so that an overlay without one (a `LoadBalancer`
Service, a Gateway, a mesh) simply leaves it out of `components:`. Its
`ingressClassName` and any cert-manager annotation are commented out in
`components/ingress/ingress.yaml` — uncomment them in a copy, or patch them from
the overlay.

## What the example does not cover

- **More than one replica.** Sessions are in memory by default, so a login on
  one pod is unknown to the next. Set `session.store.kind: valkey` in the
  config (see the README's `session` section) and raise `replicas`. The Valkey
  itself is yours to run.
- **A sqlite store.** `session.store.kind: sqlite` or `files.store.kind: sqlite`
  needs a PersistentVolumeClaim mounted at the configured path, and
  `replicas: 1`: the store holds an exclusive lock on its file and a second pod
  fails on its first read, by design. The root filesystem is read-only, so the
  path has to be on the mounted volume.
- **Pulling a private image**, network policies, a PodDisruptionBudget, an HPA.
  All ordinary additions to an overlay.

The pod runs as uid 1000 with a read-only root filesystem, no capabilities and
no service account token, which the published image supports as shipped.
