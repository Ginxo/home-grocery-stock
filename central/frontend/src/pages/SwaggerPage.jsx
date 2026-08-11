import React from "react";
import { PageSection, Title, Alert, Spinner } from "@patternfly/react-core";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

const BRIDGE_PROXY_BASE = "/api/bridge/proxy";

function rewriteSpecForProxy(spec) {
  const next = { ...spec };
  if (next.swagger === "2.0" || !next.openapi) {
    const copy = { ...next };
    delete copy.host;
    copy.basePath = BRIDGE_PROXY_BASE;
    copy.schemes = [window.location.protocol === "https:" ? "https" : "http"];
    return copy;
  }
  return {
    ...next,
    servers: [
      {
        url: BRIDGE_PROXY_BASE,
        description: "Proxied through home-grocery-stock-central to bridge",
      },
    ],
  };
}

export default function SwaggerPage() {
  const [error, setError] = React.useState(null);
  const [spec, setSpec] = React.useState(null);

  React.useEffect(() => {
    fetch("/api/bridge/openapi")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        setSpec(rewriteSpecForProxy(json));
        setError(null);
      })
      .catch((err) => {
        setError(err.message || String(err));
        setSpec(null);
      });
  }, []);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Bridge API</Title>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Failed to load OpenAPI contract" isInline>
            {error}. Ensure the bridge service is running and exposes /apispec.json.
          </Alert>
        )}
        {!error && !spec && <Spinner aria-label="Loading OpenAPI" />}
        {spec && <SwaggerUI spec={spec} />}
      </PageSection>
    </>
  );
}
