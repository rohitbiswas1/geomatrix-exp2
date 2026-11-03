"""Geomatrix v2 GIS Map Router"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import Project
from schemas import GeoFeatureCollection, GeoFeature

router = APIRouter(prefix="/api/map", tags=["map"])


@router.get("/geojson", response_model=GeoFeatureCollection)
def get_geojson(
    risk_level: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Returns GeoJSON FeatureCollection of real project coordinates from DB.
    Projects without recorded coordinates are omitted; no locations are inferred.
    """
    q = db.query(Project).filter(Project.data_classification == "REAL")
    if risk_level:
        q = q.filter(Project.risk_level == risk_level)

    projects = q.all()

    features = []
    for idx, p in enumerate(projects):
        lat = p.latitude
        lng = p.longitude
        if lat is None or lng is None:
            continue

        feat = GeoFeature(
            geometry={
                "type": "Point",
                "coordinates": [lng, lat]
            },
            properties={
                "id": p.id,
                "project_code": p.project_code,
                "name": p.name,
                "state": p.state,
                "district": p.district,
                "authority": p.authority,
                "project_type": p.project_type,
                "current_stage": p.current_stage,
                "status": p.status,
                "risk_score": p.risk_score,
                "risk_level": p.risk_level,
                "delay_probability": p.delay_probability,
                "predicted_delay_days": p.predicted_delay_days,
                "land_required": p.land_required,
                "affected_families": p.affected_families,
                "source_url": p.source_url,
            }
        )
        features.append(feat)

    return GeoFeatureCollection(features=features)


@router.get("/summary")
def map_summary(db: Session = Depends(get_db)):
    total = db.query(Project).filter(Project.data_classification == "REAL").count()
    with_coords = db.query(Project).filter(Project.data_classification == "REAL").filter(
        Project.latitude.isnot(None),
        Project.longitude.isnot(None),
    ).count()
    return {
        "total_projects": total,
        "projects_with_coordinates": with_coords,
        "projects_without_coordinates": total - with_coords,
    }


@router.get("/projects")
def map_projects(db: Session = Depends(get_db)):
    return {"data": get_geojson(None, db).model_dump()["features"]}
