from django.db import models
from django.utils import timezone
from django.utils.timezone import now

class Note(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True)
    version = models.IntegerField(default=0)
    updated_at = models.DateTimeField(default=now)

    def to_change(self):
        return {
            "type": "note",
            "id": self.id,
            "op": "upsert",
            "version": self.version,
            "updated_at": self.updated_at.isoformat(),
            "data": {"title": self.title, "content": self.content}
        }

class Idempotency(models.Model):
    key = models.CharField(primary_key=True, max_length=128)
    response_json = models.TextField()

class Event(models.Model):
    entity_type = models.CharField(max_length=64)
    entity_id = models.CharField(max_length=64)
    op = models.CharField(max_length=16)
    version = models.IntegerField()
    updated_at = models.DateTimeField(default=now)
