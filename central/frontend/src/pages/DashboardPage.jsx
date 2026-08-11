import React from "react";
import {
  PageSection,
  Title,
  Card,
  CardTitle,
  CardBody,
  CardFooter,
  Button,
  Gallery,
  GalleryItem,
  Content,
} from "@patternfly/react-core";
import RhUiExternalLinkIcon from "@patternfly/react-icons/dist/esm/icons/rh-ui-external-link-icon";
import { grocyUrl, frigateUrl } from "../utils/urls";

const LINKS = [
  {
    id: "grocy",
    title: "Grocy",
    description: "Inventory ERP — products, stock levels, and consumption.",
    href: grocyUrl,
  },
  {
    id: "frigate",
    title: "Frigate",
    description: "AI vision UI — live feeds, zones, and detection debug.",
    href: frigateUrl,
  },
];

export default function DashboardPage() {
  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Developer Dashboard</Title>
        <Content component="p">
          Central technical management console for home-grocery-stock services.
        </Content>
      </PageSection>
      <PageSection>
        <Gallery hasGutter minWidths={{ default: "280px" }}>
          {LINKS.map((link) => (
            <GalleryItem key={link.id}>
              <Card isFullHeight>
                <CardTitle>{link.title}</CardTitle>
                <CardBody>{link.description}</CardBody>
                <CardFooter>
                  <Button
                    variant="link"
                    icon={<RhUiExternalLinkIcon />}
                    iconPosition="end"
                    component="a"
                    href={link.href()}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open {link.title}
                  </Button>
                </CardFooter>
              </Card>
            </GalleryItem>
          ))}
        </Gallery>
      </PageSection>
    </>
  );
}
