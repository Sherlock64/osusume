---
name: minikube-deploy
description: Build the Osusume images and deploy them to the owner's minikube cluster so the owner can review a change. Use when the owner says "push" or "deploy" about the site, or a feature is ready for human review.
---

# Deploy to minikube for the owner

The minikube install is the owner's real install. It sends real email. Deploy only when the owner asks, or when the feature flow says that a change is ready for the owner.

When the owner says "push" about the site, it means this deploy. It does not mean `git push`.

## Before you deploy

1. All checks pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
2. `compose-validate` passed.
3. minikube runs: `minikube status`. If it does not, tell the owner. Do not start or delete the cluster yourself.

## Deploy

Use a new tag for each build: the short commit hash, a topic and a number, for example `9411672-search1`. If the tag does not change, the pods do not change.

```sh
TAG=$(git rev-parse --short HEAD)-<topic><n>
for target in api web; do
  podman build --target $target -t localhost/osusume-$target:$TAG -f Containerfile .
  podman save -o /tmp/osusume-$target.tar localhost/osusume-$target:$TAG
  minikube image load /tmp/osusume-$target.tar
  rm /tmp/osusume-$target.tar
done
helm upgrade --install osusume infra/helm/osusume -n osusume -f infra/helm/values.local.yaml \
  --set image.api.tag=$TAG --set image.web.tag=$TAG --wait --timeout 5m
```

If only the web app changed, you can build only `web` and set only `image.web.tag`. Then the api keeps its tag.

## After the deploy

1. Make sure that the port-forward runs: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/`. If it does not, start it in the background: `kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8080:80`.
2. Do one quick check of the changed pages. Do not run `pnpm smoke` against port 8080 without the owner's admin login.
3. Tell the owner the tag and the address http://localhost:8080. Write the tag in the pull request.

Never delete the `osusume` namespace. That deletes the owner's data permanently.
