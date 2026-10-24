import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoverProject } from "./local-discovery.mjs";
import { planProject } from "./local-api/projects.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), "portolan-discovery-deployment-"));
  roots.push(root);
  return root;
}

function write(root, name, contents) {
  mkdirSync(join(root, name, ".."), { recursive: true });
  writeFileSync(join(root, name), contents);
}

describe("messaging and deployment discovery", () => {
  it("offers the existing Python Kafka extractor when source imports a supported client", () => {
    const root = project();
    write(root, "requirements.txt", "confluent-kafka==2.5.0\n");
    write(root, "util/kafka.py", "from confluent_kafka import Producer\n\nproducer = Producer({})\nproducer.produce('orders', b'created')\n");

    const found = discoverProject(root, ".").detections.find((item) => item.plugin === "python-kafka");

    expect(found).toMatchObject({
      confidence: "high",
      evidence: "util/kafka.py",
      selected: true,
    });
  });

  it("offers the existing Go Kafka extractor when source imports a supported client", () => {
    const root = project();
    write(root, "go.mod", "module example.com/booking\n\ngo 1.24\n");
    write(root, "internal/events/publisher.go", `package events

import "github.com/IBM/sarama"

func publish(producer sarama.SyncProducer) error {
  _, _, err := producer.SendMessage(&sarama.ProducerMessage{Topic: "booking.updated"})
  return err
}
`);

    const found = discoverProject(root, ".").detections.find((item) => item.plugin === "go-kafka");

    expect(found).toMatchObject({
      confidence: "high",
      evidence: "internal/events/publisher.go",
      selected: true,
    });
  });

  it("finds deployment values by exact overlap with environment variables used by code", () => {
    const root = project();
    write(root, "go.mod", "module example.com/aviacore\n\ngo 1.24\n");
    write(root, "internal/config/config.go", `package config

type Config struct {
  Supplier string \`envconfig:"AVIASUPP_ADDR" default:"http://localhost:8080"\`
  Topic string \`envconfig:"KAFKA_BOOKING_UPDATE_IN_TOPIC" default:"booking-update-in"\`
}
`);
    write(root, ".helm-ovh/configmap.prod.yaml", `configmap:
  AVIASUPP_ADDR: http://aviasupp.srv.team
  KAFKA_BOOKING_UPDATE_IN_TOPIC: avia-suppliers-events
  PASSWORD: vault:prod/data/apps/aviacore#password
`);
    write(root, "docs/example.yaml", "AVIASUPP_ADDR: documentation-only\n");
    write(root, ".claude/worktrees/old/.helm-ovh/configmap.prod.yaml", `configmap:
  AVIASUPP_ADDR: http://stale-copy.srv.team
  KAFKA_BOOKING_UPDATE_IN_TOPIC: stale-copy
`);

    const found = discoverProject(root, ".").detections.find((item) => item.plugin === "deployment-values");

    expect(found).toMatchObject({
      confidence: "high",
      candidates: [".helm-ovh/configmap.prod.yaml"],
      options: {
        paths: [".helm-ovh/configmap.prod.yaml"],
        variables: ["AVIASUPP_ADDR", "KAFKA_BOOKING_UPDATE_IN_TOPIC"],
      },
      selected: true,
    });

    const plan = planProject(root, { projects: [], plugins: [], extract: [] }, {
      source: "local",
      root: ".",
      id: "aviacore",
      name: "aviacore",
      group: "avia",
      component: "aviacore",
      plugins: ["deployment-values"],
    });
    expect(plan.steps).toEqual([
      {
        plugin: "deployment-values",
        in: ".",
        out: "portolan",
        options: {
          context: "avia",
          service: "aviacore",
          paths: [".helm-ovh/configmap.prod.yaml"],
          variables: ["AVIASUPP_ADDR", "KAFKA_BOOKING_UPDATE_IN_TOPIC"],
          out: "deployment-values.json",
        },
      },
    ]);
  });
});
