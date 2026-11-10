"""F1SION backend application entrypoint.

Configures the FastAPI application instance, CORS middleware policies,
and registers API routers for telemetry and machine learning services.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router

app = FastAPI(
    title="F1SION",
    description="Beyond the race. Into the data. An F1 analytics, prediction and simulation platform.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure Cross-Origin Resource Sharing (CORS) for decoupled frontend clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite development server default
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*",                      # Permissive in local development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(router)


@app.get("/", tags=["Root"])
def root() -> dict[str, str]:
    """Root metadata endpoint providing links to documentation and health check."""
    return {
        "project": "F1SION",
        "tagline": "Beyond the race. Into the data.",
        "version": "0.1.0",
        "status": "operational",
        "documentation": "/docs",
        "health": "/api/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
