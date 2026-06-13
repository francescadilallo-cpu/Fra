"""Unit tests for ontology/ontology.py (Ontology, _validate_yaml_schema)
and ontology/manufacturing.py (ManufacturingOntology).
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.ontology.manufacturing import (
    CLASSES,
    CLASS_TO_TABLE,
    OBJECT_PROPERTIES,
    ManufacturingOntology,
)
from app.ontology.ontology import (
    Ontology,
    OntologyValidationError,
    _ENTITY_REGISTRY,
    _validate_yaml_schema,
)


# ── _validate_yaml_schema ──────────────────────────────────────────────────────


MINIMAL_VALID_YAML: dict = {
    "ontology_version": "1.0",
    "entities": {
        "SalesOrder": {
            "description": "A confirmed order",
            "sources": [{"source": "erp", "table": "sales_order_header"}],
            "attributes": {},
        },
        "Customer": {
            "sources": [{"source": "crm", "table": "account"}],
            "attributes": {},
        },
    },
    "metrics": {},
    "dimensions": {},
    "known_ambiguities": [],
}


class TestValidateYamlSchema:
    def test_valid_minimal_passes(self):
        _validate_yaml_schema(MINIMAL_VALID_YAML)  # must not raise

    def test_non_dict_root_raises(self):
        with pytest.raises(OntologyValidationError, match="root must be a dictionary"):
            _validate_yaml_schema(["list", "not", "dict"])  # type: ignore

    def test_entities_not_dict_raises(self):
        with pytest.raises(
            OntologyValidationError, match="entities must be a dictionary"
        ):
            _validate_yaml_schema({"entities": ["SalesOrder"]})

    def test_entity_config_not_dict_raises(self):
        with pytest.raises(
            OntologyValidationError, match="config must be a dictionary"
        ):
            _validate_yaml_schema({"entities": {"SalesOrder": "not a dict"}})

    def test_sources_not_list_raises(self):
        data = {
            "entities": {
                "SalesOrder": {"sources": "erp"}  # string, not list
            }
        }
        with pytest.raises(OntologyValidationError, match="sources must be a list"):
            _validate_yaml_schema(data)

    def test_source_entry_missing_table_raises(self):
        data = {
            "entities": {
                "SalesOrder": {
                    "sources": [{"source": "erp"}]  # no table
                }
            }
        }
        with pytest.raises(
            OntologyValidationError, match="must include 'source' and 'table'"
        ):
            _validate_yaml_schema(data)

    def test_source_entry_missing_source_raises(self):
        data = {
            "entities": {
                "SalesOrder": {
                    "sources": [{"table": "orders"}]  # no source
                }
            }
        }
        with pytest.raises(
            OntologyValidationError, match="must include 'source' and 'table'"
        ):
            _validate_yaml_schema(data)

    def test_relation_invalid_target_raises(self):
        data = {
            "entities": {
                "SalesOrder": {
                    "attributes": {
                        "customer": {
                            "relation": "many_to_one",
                            "target": "NonExistentEntity",
                            "via": "customer_id",
                        }
                    }
                }
            }
        }
        with pytest.raises(OntologyValidationError, match="invalid target"):
            _validate_yaml_schema(data)

    def test_relation_undeclared_target_raises(self):
        data = {
            "entities": {
                "SalesOrder": {
                    "attributes": {
                        "customer": {
                            "relation": "many_to_one",
                            "target": "Customer",  # valid registry entity but not declared
                            "via": "customer_id",
                        }
                    }
                }
            }
        }
        with pytest.raises(OntologyValidationError, match="undeclared"):
            _validate_yaml_schema(data)

    def test_metrics_not_dict_raises(self):
        data = {"entities": {}, "metrics": ["revenue"]}
        with pytest.raises(
            OntologyValidationError, match="metrics must be a dictionary"
        ):
            _validate_yaml_schema(data)

    def test_ambiguities_not_list_raises(self):
        data = {"entities": {}, "known_ambiguities": "not a list"}
        with pytest.raises(OntologyValidationError, match="must be a list"):
            _validate_yaml_schema(data)

    def test_null_metrics_allowed_by_validator(self):
        # The validator explicitly permits metrics: null (only non-null non-dict is invalid)
        _validate_yaml_schema({"entities": {}, "metrics": None})  # must not raise

    def test_null_dimensions_allowed_by_validator(self):
        _validate_yaml_schema({"entities": {}, "dimensions": None})  # must not raise

    def test_null_ambiguities_allowed_by_validator(self):
        _validate_yaml_schema(
            {"entities": {}, "known_ambiguities": None}
        )  # must not raise

    def test_custom_entity_allowed(self):
        # Custom (non-registry) entities should pass without error
        data = {
            "entities": {
                "Supplier": {
                    "description": "A supplier company",
                    "sources": [{"source": "erp", "table": "vendors"}],
                }
            }
        }
        _validate_yaml_schema(data)  # must not raise

    def test_relation_to_declared_custom_entity_allowed(self):
        # A relation may target a custom entity that is declared in this YAML,
        # not only canonical-registry entities (e.g. Supplier, Vendor).
        data = {
            "entities": {
                "Supplier": {
                    "description": "A supplier company",
                    "sources": [{"source": "erp", "table": "vendors"}],
                },
                "Product": {
                    "attributes": {
                        "supplied_by": {
                            "relation": "many_to_one",
                            "target": "Supplier",
                            "via": "supplier_id",
                        }
                    }
                },
            }
        }
        _validate_yaml_schema(data)  # must not raise

    def test_relation_to_unknown_target_still_raises(self):
        # Regression guard: a target that is neither canonical nor declared
        # must still fail, even after custom-entity targets are allowed.
        data = {
            "entities": {
                "Product": {
                    "attributes": {
                        "supplied_by": {
                            "relation": "many_to_one",
                            "target": "GhostEntity",
                            "via": "supplier_id",
                        }
                    }
                }
            }
        }
        with pytest.raises(OntologyValidationError, match="invalid target"):
            _validate_yaml_schema(data)


# ── Ontology class ─────────────────────────────────────────────────────────────


@pytest.fixture()
def ontology_yaml(tmp_path) -> Path:
    data = {
        "ontology_version": "1.0",
        "entities": {
            "SalesOrder": {
                "description": "A confirmed sales order",
                "sources": [{"source": "erp", "table": "sales_order_header"}],
                "attributes": {
                    "customer": {
                        "relation": "many_to_one",
                        "target": "Customer",
                        "via": "customer_id",
                    }
                },
            },
            "Customer": {
                "description": "A buying customer",
                "sources": [{"source": "crm", "table": "account"}],
                "attributes": {},
            },
        },
        "metrics": {
            "revenue": {"description": "Net revenue", "formula": "SUM(subtotal)"},
        },
        "dimensions": {
            "date": {"description": "Order date", "field": "order_date"},
        },
        "known_ambiguities": [
            {"term": "fatturato", "candidates": ["revenue", "total_due"]}
        ],
    }
    p = tmp_path / "ontology.yaml"
    p.write_text(yaml.dump(data), encoding="utf-8")
    return p


class TestOntologyLoad:
    def test_load_from_file(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        assert o is not None

    def test_entity_names_includes_yaml_entities(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        names = o.entity_names()
        assert "SalesOrder" in names
        assert "Customer" in names

    def test_entity_names_includes_registry_entities(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        names = o.entity_names()
        for name in _ENTITY_REGISTRY:
            assert name in names

    def test_entity_returns_pydantic_class(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        cls = o.entity("SalesOrder")
        assert issubclass(cls, object)

    def test_entity_unknown_returns_base_class(self, ontology_yaml):
        from app.ontology.ontology import OntologyEntity

        o = Ontology.load(ontology_yaml)
        cls = o.entity("Nonexistent")
        assert cls is OntologyEntity

    def test_relations_of_returns_relation(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        rels = o.relations_of("SalesOrder")
        assert len(rels) == 1
        assert rels[0]["name"] == "customer"
        assert rels[0]["target"] == "Customer"
        assert rels[0]["via"] == "customer_id"

    def test_relations_of_no_relations_returns_empty(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        assert o.relations_of("Customer") == []

    def test_metric_names(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        assert "revenue" in o.metric_names()

    def test_metric_returns_config(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        m = o.metric("revenue")
        assert m["description"] == "Net revenue"

    def test_null_metrics_does_not_crash_metric_names(self):
        # metrics: null in YAML must not cause AttributeError in metric_names()
        o = Ontology({"entities": {}, "metrics": None})
        assert o.metric_names() == []

    def test_null_dimensions_does_not_crash_dimension_names(self):
        o = Ontology({"entities": {}, "dimensions": None})
        assert o.dimension_names() == []

    def test_null_ambiguities_does_not_crash_known_ambiguities(self):
        o = Ontology({"entities": {}, "known_ambiguities": None})
        assert o.known_ambiguities() == []

    def test_dimension_names(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        assert "date" in o.dimension_names()

    def test_known_ambiguities(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        amb = o.known_ambiguities()
        assert len(amb) == 1
        assert amb[0]["term"] == "fatturato"

    def test_entity_sources(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        sources = o.entity_sources("SalesOrder")
        assert sources[0]["source"] == "erp"

    def test_entity_description(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        desc = o.entity_description("SalesOrder")
        assert "order" in desc.lower()

    def test_repr_contains_entities(self, ontology_yaml):
        o = Ontology.load(ontology_yaml)
        r = repr(o)
        assert "Ontology" in r

    def test_to_rdf_emits_canonical_classes(self, ontology_yaml):
        rdflib = pytest.importorskip("rdflib")
        from rdflib.namespace import OWL, RDF

        o = Ontology.load(ontology_yaml)
        g = o.to_rdf()
        fra = rdflib.Namespace("https://fra.example/ontology#")
        assert (fra["Customer"], RDF.type, OWL.Class) in g
        assert (fra["SalesOrder"], RDF.type, OWL.Class) in g

    def test_to_rdf_emits_relation_with_range(self, ontology_yaml):
        rdflib = pytest.importorskip("rdflib")
        from rdflib.namespace import OWL, RDF, RDFS

        o = Ontology.load(ontology_yaml)
        g = o.to_rdf()
        fra = rdflib.Namespace("https://fra.example/ontology#")
        rel_uri = fra["SalesOrder.customer"]
        assert (rel_uri, RDF.type, OWL.ObjectProperty) in g
        assert (rel_uri, RDFS.range, fra["Customer"]) in g

    def test_to_rdf_emits_custom_entity_and_relation_range(self, tmp_path):
        rdflib = pytest.importorskip("rdflib")
        from rdflib.namespace import OWL, RDF, RDFS

        data = {
            "ontology_version": "1.0",
            "entities": {
                "Supplier": {
                    "description": "A supplier company",
                    "sources": [{"source": "erp", "table": "vendors"}],
                },
                "Product": {
                    "sources": [{"source": "erp", "table": "products"}],
                    "attributes": {
                        "supplied_by": {
                            "relation": "many_to_one",
                            "target": "Supplier",
                            "via": "supplier_id",
                        }
                    },
                },
            },
        }
        p = tmp_path / "custom.yaml"
        p.write_text(yaml.dump(data), encoding="utf-8")

        o = Ontology.load(p)
        g = o.to_rdf()
        fra = rdflib.Namespace("https://fra.example/ontology#")
        # The custom entity is emitted as an OWL class...
        assert (fra["Supplier"], RDF.type, OWL.Class) in g
        # ...and a relation targeting it carries a proper RDFS range.
        rel_uri = fra["Product.supplied_by"]
        assert (rel_uri, RDF.type, OWL.ObjectProperty) in g
        assert (rel_uri, RDFS.range, fra["Supplier"]) in g


# ── ManufacturingOntology ──────────────────────────────────────────────────────


@pytest.fixture()
def mfg_db(tmp_path) -> sqlite3.Connection:
    """Minimal DB with a few rows for ManufacturingOntology tests."""
    import app.database as db_module

    monkeypatch_path = tmp_path / "mfg_test.db"

    # Use the real init_db via monkeypatching DB_PATH
    original = db_module.DB_PATH
    db_module.DB_PATH = monkeypatch_path
    try:
        db_module.init_db()
    finally:
        db_module.DB_PATH = original

    conn = sqlite3.connect(str(monkeypatch_path))
    conn.row_factory = sqlite3.Row
    return conn


class TestManufacturingOntology:
    def test_init_builds_graph(self):
        onto = ManufacturingOntology()
        # Graph should have triples (schema defined)
        assert len(onto.g) > 0

    def test_all_classes_in_graph(self):
        from rdflib import OWL, RDF

        onto = ManufacturingOntology()
        for uri in CLASSES.values():
            assert (uri, RDF.type, OWL.Class) in onto.g

    def test_object_properties_in_graph(self):
        from rdflib import OWL, RDF
        from app.ontology.manufacturing import MFG

        onto = ManufacturingOntology()
        for prop_name in OBJECT_PROPERTIES:
            prop_uri = MFG[prop_name]
            assert (prop_uri, RDF.type, OWL.ObjectProperty) in onto.g

    def test_get_ontology_graph_data_nodes(self):
        onto = ManufacturingOntology()
        data = onto.get_ontology_graph_data()
        assert "nodes" in data
        assert len(data["nodes"]) == len(CLASSES)

    def test_get_ontology_graph_data_edges(self):
        onto = ManufacturingOntology()
        data = onto.get_ontology_graph_data()
        assert "edges" in data
        # At least some edges should be present
        assert len(data["edges"]) > 0

    def test_node_has_required_fields(self):
        onto = ManufacturingOntology()
        node = onto.get_ontology_graph_data()["nodes"][0]
        assert "id" in node
        assert "position" in node
        assert "data" in node
        assert "label" in node["data"]

    def test_populate_from_db_adds_instances(self, mfg_db):
        onto = ManufacturingOntology()
        triples_before = len(onto.g)
        onto.populate_from_db(mfg_db)
        # Instance data should add many more triples
        assert len(onto.g) > triples_before

    def test_populate_sets_row_counts(self, mfg_db):
        onto = ManufacturingOntology()
        onto.populate_from_db(mfg_db)
        assert onto._row_counts.get("customers", 0) > 0
        assert onto._row_counts.get("products", 0) > 0

    def test_class_to_table_covers_all_classes(self):
        for class_name in CLASSES:
            # Organization is abstract — not in CLASS_TO_TABLE
            if class_name != "Organization":
                assert class_name in CLASS_TO_TABLE
