
### Functional Requirements

1. Transfer events
    1. **Fetch:** (*) the transfer events from the blockchain into memory.
    2. **Persist:** the event information in storage.

### Non-Functional Requirements

1. **Resilience:** (*) The system should be able to continue operating even if there is an error on one event.
2. **Recovery:** (*) The system should be able to index events that were emitted even when the system was offline.
3. **Parallelism:** The system should be able to handle events in parallel. In other words, the system should be able to scale horizontally.


event abi
{
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
                "name": "from",
                "type": "address"
            },
            {
                "indexed": true,
                "name": "to",
                "type": "address"
            },
            {
                "indexed": false,
                "name": "value",
                "type": "uint256"
            }
        ],
        "name": "Transfer",
        "type": "event"
    }


notas:
- un smart contract como USDC tiene muchos eventos en un solo bloque. hay que encontrar una manera de que 2 procesos procesen el mismo bloque y guarden los eventos sin colisionar (no prioritario)
- para guardar eventos como primer apprach pensaria en un json sencillo guardar en una linea from, to, value. tambien podria ser un csv. tambien hay que guardar el block number, block hash o log hash algun identificador unico
- hay que guardar el ultimo bloque procesado
- hay un tema con el numero de confirmaciones de un bloque. utilizamos polling para obtener los eventos mas recientes pero confirmados. buscando en internet vi que el numero de bloques para que un evento se considere permanente es de 12, utilizare 15 para agregar mas seguridad,
- hay que usar polling, tendremos init block y el ultimo block sera el latest - confirmations (15)
- si un evento contiene error, no debe de detenerse el proceso, debe continuar guardando datos
- importante el tema de recovery, guardar el last procesed block 
- el tema del parallelism lo retomaremos despues


24248600 - init block
- se pushea un nuevo bloque cada 10 seg
- el batch sera de 2 bloques: ejemplo del 24248600 al bloque 24248605
- si el bloque mas reciente es 24248650, hay que restar 15 bloques, que son los bloques de confirmacion. Hay que guardar solo eventos de bloques confirmados
- entonces el algoritmo deberia ser
un cronjob que corra cada 10s y cheque el ultimo bloque, guardar last checked block
cuando se cree un umbral entre el bloque reciente - 15 bloques ya podemos procesar

